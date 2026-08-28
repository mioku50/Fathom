import { Address } from 'viem';
import { DEXAdapter, PoolInfo, RawPoolData, SellQuoteRequest, TwapRequest, TwapResult } from '../dex_adapter';
import { PriceRpcClient, isRpcFailure } from '../utils/price_rpc';

export class AerodromeAdapter implements DEXAdapter {
  readonly id = 'aerodrome';
  private client: PriceRpcClient;
  // Common quote tokens for Base (WETH, USDC)
  private quoteTokens: Address[] = [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'  // USDC
  ];

  // Aerodrome v2 factory on Base
  private factoryAddress: Address = '0x420dd381b31aef6683db6b902084cb0ffece40da';

  // Aerodrome Router on Base - the canonical source of executable quotes.
  private routerAddress: Address = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';

  private pinBlock?: bigint;

  /**
   * @param sharedClient Reuse one RPC client across every adapter in a request.
   *   Without it each adapter builds its own viem client, so a 50-token batch
   *   used to construct 200 of them.
   */
  constructor(rpcUrl: string, fallbackUrlsStr?: string, pinBlock?: string, sharedClient?: PriceRpcClient) {
    if (pinBlock && pinBlock !== 'latest') {
      this.pinBlock = BigInt(pinBlock);
    }
    this.client = sharedClient ?? new PriceRpcClient(rpcUrl, fallbackUrlsStr);
  }

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = [];

    // ABI for Aerodrome Factory getPool
    const factoryAbi = [
      {
        inputs: [
          { internalType: "address", name: "", type: "address" },
          { internalType: "address", name: "", type: "address" },
          { internalType: "bool", name: "", type: "bool" }
        ],
        name: "getPool",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      }
    ] as const;

    // One multicall for all (quote, stable) combinations instead of four
    // sequential round trips per token.
    const probes: { quoteToken: Address; stable: boolean }[] = [];
    for (const quoteToken of this.quoteTokens) {
      if (tokenAddress.toLowerCase() === quoteToken.toLowerCase()) continue;
      for (const stable of [false, true]) {
        probes.push({ quoteToken, stable });
      }
    }

    if (probes.length === 0) return [];

    let results: any[];
    try {
      results = await this.client.multicall({
        contracts: probes.map(({ quoteToken, stable }) => ({
          address: this.factoryAddress,
          abi: factoryAbi,
          functionName: 'getPool',
          args: [tokenAddress as Address, quoteToken, stable]
        })),
        allowFailure: true,
        blockNumber: this.pinBlock
      });
    } catch (error: any) {
      if (isRpcFailure(error)) {
        console.error('RPC FAILURE DETAILS:', error);
        throw new Error(`RPC rate limit exceeded while checking pools for ${tokenAddress}`);
      }
      console.error(`Error checking pools for ${tokenAddress}:`, error.message);
      return [];
    }

    results.forEach((result, i) => {
      const { quoteToken, stable } = probes[i];
      if (result?.status !== 'success') {
        console.error(`Error checking pool for ${tokenAddress} and ${quoteToken}:`, result?.error?.message);
        return;
      }
      const poolAddress = result.result;
      if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
        pools.push({
          address: poolAddress,
          dex: 'aerodrome',
          fee: stable ? 0.0005 : 0.003, // Simplified, actual fees vary
          stable
        });
      }
    });

    return pools;
  }

  async getRawData(poolAddress: string): Promise<RawPoolData> {
    // ABI for Aerodrome Pool getReserves
    const poolAbi = [
      {
        inputs: [],
        name: "getReserves",
        outputs: [
          { internalType: "uint256", name: "_reserve0", type: "uint256" },
          { internalType: "uint256", name: "_reserve1", type: "uint256" },
          { internalType: "uint256", name: "_blockTimestampLast", type: "uint256" }
        ],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "token0",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "token1",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      }
    ] as const;

    try {
      // Single round trip; also guarantees reserves and tokens share one block.
      const [reserves, token0, token1] = await this.client.multicall({
        contracts: (['getReserves', 'token0', 'token1'] as const).map(functionName => ({
          address: poolAddress as Address,
          abi: poolAbi,
          functionName
        })),
        allowFailure: false,
        blockNumber: this.pinBlock
      }) as [any, string, string];

      return {
        reserve0: reserves[0],
        reserve1: reserves[1],
        token0: token0 as string,
        token1: token1 as string,
        updatedAt: Number(reserves[2])
      };
    } catch (error: any) {
      if (isRpcFailure(error)) {
        throw new Error(`RPC rate limit exceeded while fetching raw data for pool ${poolAddress}`);
      }
      throw new Error(`Failed to fetch raw data for pool ${poolAddress}: ${error.message}`);
    }
  }

  /**
   * Stable pools follow x3y+y3x, which has no convenient closed form, and the
   * router is authoritative for both curves anyway. One multicall covers every
   * requested size.
   */
  async quoteSell(request: SellQuoteRequest): Promise<(bigint | null)[]> {
    const routerAbi = [
      {
        inputs: [
          { internalType: "uint256", name: "amountIn", type: "uint256" },
          {
            components: [
              { internalType: "address", name: "from", type: "address" },
              { internalType: "address", name: "to", type: "address" },
              { internalType: "bool", name: "stable", type: "bool" },
              { internalType: "address", name: "factory", type: "address" }
            ],
            internalType: "struct IRouter.Route[]",
            name: "routes",
            type: "tuple[]"
          }
        ],
        name: "getAmountsOut",
        outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
        stateMutability: "view",
        type: "function"
      }
    ] as const;

    const route = [{
      from: request.tokenIn as Address,
      to: request.tokenOut as Address,
      stable: request.pool.stable === true,
      factory: this.factoryAddress
    }];

    const results = await this.client.multicall({
      contracts: request.amountsIn.map(amountIn => ({
        address: this.routerAddress,
        abi: routerAbi,
        functionName: 'getAmountsOut',
        args: [amountIn, route]
      })),
      allowFailure: true,
      blockNumber: this.pinBlock
    });

    // getAmountsOut returns one amount per hop boundary; the last is the output.
    return results.map((r: any) => {
      if (r?.status !== 'success' || !Array.isArray(r.result) || r.result.length === 0) return null;
      const out = r.result[r.result.length - 1];
      return typeof out === 'bigint' && out > 0n ? out : null;
    });
  }

  /**
   * Aerodrome v2 pools keep their own cumulative-price oracle. `quote` averages
   * over `granularity` stored points, each one `periodSize` long, so the window
   * is read from the pool rather than assumed.
   */
  async getTwapAmountOut(request: TwapRequest): Promise<TwapResult | null> {
    const abi = [
      {
        inputs: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint256', name: 'granularity', type: 'uint256' }
        ],
        name: 'quote',
        outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function'
      },
      {
        inputs: [],
        name: 'periodSize',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function'
      }
    ] as const;

    // Cover at least the requested window, one stored period at a time.
    const results = await this.client.multicall({
      contracts: [
        {
          address: request.pool.address as Address,
          abi,
          functionName: 'periodSize'
        },
        {
          address: request.pool.address as Address,
          abi,
          functionName: 'quote',
          args: [request.tokenIn as Address, request.amountIn, 1n]
        }
      ],
      allowFailure: true,
      blockNumber: this.pinBlock
    });

    const periodSize: any = results[0];
    const quoted: any = results[1];
    if (quoted?.status !== 'success' || typeof quoted.result !== 'bigint' || quoted.result <= 0n) {
      return null;
    }
    // Without periodSize we cannot say what window this averages over, and an
    // unlabelled TWAP is not a TWAP a caller can reason about.
    if (periodSize?.status !== 'success') return null;

    const windowSeconds = Number(periodSize.result);
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return null;

    return { amountOut: quoted.result, windowSeconds };
  }
}
