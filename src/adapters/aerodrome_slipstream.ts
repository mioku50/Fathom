import { Address } from 'viem';
import { DEXAdapter, PoolInfo, RawPoolData, SellQuoteRequest, TwapRequest, TwapResult } from '../dex_adapter';
import { readConcentratedTwap } from './cl_twap';
import { PriceRpcClient, isRpcFailure } from '../utils/price_rpc';

/**
 * Aerodrome Slipstream - Aerodrome's concentrated-liquidity AMM, and the
 * largest source of long-tail liquidity on Base that Fathom was not reading.
 *
 * Pools are keyed by tick spacing rather than a fee tier, and more than one CL
 * factory is live at a time, so factories are read from the FactoryRegistry
 * rather than hardcoded. Every address and ABI here was verified against Base
 * mainnet: the registry currently lists one v2 factory and three CL factories,
 * and the well-known "SlipStream Pool Factory" address published by block
 * explorers is not among them.
 */
export class AerodromeSlipstreamAdapter implements DEXAdapter {
  readonly id = 'aerodrome_slipstream';
  private client: PriceRpcClient;

  private quoteTokens: Address[] = [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'  // USDC
  ];

  // Aerodrome FactoryRegistry on Base.
  private registryAddress: Address = '0x5c3f18f06cc09ca1910767a34a20f771039e37c0';

  // Slipstream Quoter on Base; takes tickSpacing where Uniswap takes a fee tier.
  private quoterAddress: Address = '0x254cf9e1e6e233aa1ac962cb9b05b2cfeaae15b0';

  private pinBlock?: bigint;

  /**
   * Registry topology is memoized per adapter instance. The engine builds one
   * per request, so a 50-token batch pays for this discovery once, not 50 times.
   */
  private topology?: Promise<{ factory: Address; tickSpacings: number[] }[]>;

  constructor(rpcUrl: string, fallbackUrlsStr?: string, pinBlock?: string, sharedClient?: PriceRpcClient) {
    if (pinBlock && pinBlock !== 'latest') {
      this.pinBlock = BigInt(pinBlock);
    }
    this.client = sharedClient ?? new PriceRpcClient(rpcUrl, fallbackUrlsStr);
  }

  /** Which CL factories exist right now, and what tick spacings each offers. */
  private getTopology(): Promise<{ factory: Address; tickSpacings: number[] }[]> {
    if (!this.topology) {
      this.topology = this.readTopology().catch(error => {
        // Do not cache a failure: the next token in the batch may succeed.
        this.topology = undefined;
        throw error;
      });
    }
    return this.topology;
  }

  private async readTopology(): Promise<{ factory: Address; tickSpacings: number[] }[]> {
    const registryAbi = [{
      inputs: [],
      name: 'poolFactories',
      outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
      stateMutability: 'view',
      type: 'function'
    }] as const;

    const factories = (await this.client.readContract({
      address: this.registryAddress,
      abi: registryAbi,
      functionName: 'poolFactories',
      blockNumber: this.pinBlock
    })) as Address[];

    if (!factories?.length) return [];

    const tickSpacingsAbi = [{
      inputs: [],
      name: 'tickSpacings',
      outputs: [{ internalType: 'int24[]', name: '', type: 'int24[]' }],
      stateMutability: 'view',
      type: 'function'
    }] as const;

    // The v2 factory has no tickSpacings(); allowFailure lets it drop out here
    // instead of needing a hardcoded exclusion list.
    const results = await this.client.multicall({
      contracts: factories.map(factory => ({
        address: factory,
        abi: tickSpacingsAbi,
        functionName: 'tickSpacings'
      })),
      allowFailure: true,
      blockNumber: this.pinBlock
    });

    const topology: { factory: Address; tickSpacings: number[] }[] = [];
    results.forEach((result: any, i: number) => {
      if (result?.status !== 'success' || !Array.isArray(result.result)) return;
      const tickSpacings = result.result.map((t: any) => Number(t)).filter((t: number) => Number.isFinite(t));
      if (tickSpacings.length > 0) {
        topology.push({ factory: factories[i], tickSpacings });
      }
    });

    return topology;
  }

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    let topology: { factory: Address; tickSpacings: number[] }[];
    try {
      topology = await this.getTopology();
    } catch (error: any) {
      if (isRpcFailure(error)) {
        throw new Error(`RPC rate limit exceeded while reading the Aerodrome factory registry`);
      }
      console.error('Error reading Aerodrome factory registry:', error.message);
      return [];
    }

    const probes: { factory: Address; tickSpacing: number; quoteToken: Address }[] = [];
    for (const { factory, tickSpacings } of topology) {
      for (const quoteToken of this.quoteTokens) {
        if (tokenAddress.toLowerCase() === quoteToken.toLowerCase()) continue;
        for (const tickSpacing of tickSpacings) {
          probes.push({ factory, tickSpacing, quoteToken });
        }
      }
    }

    if (probes.length === 0) return [];

    const factoryAbi = [{
      inputs: [
        { internalType: 'address', name: 'tokenA', type: 'address' },
        { internalType: 'address', name: 'tokenB', type: 'address' },
        { internalType: 'int24', name: 'tickSpacing', type: 'int24' }
      ],
      name: 'getPool',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      stateMutability: 'view',
      type: 'function'
    }] as const;

    let results: any[];
    try {
      results = await this.client.multicall({
        contracts: probes.map(({ factory, tickSpacing, quoteToken }) => ({
          address: factory,
          abi: factoryAbi,
          functionName: 'getPool',
          args: [tokenAddress as Address, quoteToken, tickSpacing]
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

    const pools: PoolInfo[] = [];
    const seen = new Set<string>();
    results.forEach((result: any, i: number) => {
      if (result?.status !== 'success') return;
      const poolAddress = result.result;
      if (!poolAddress || poolAddress === '0x0000000000000000000000000000000000000000') return;

      // Registered factories can overlap; do not double-count the same pool.
      const key = poolAddress.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      pools.push({
        address: poolAddress,
        dex: this.id,
        tickSpacing: probes[i].tickSpacing
      });
    });

    return pools;
  }

  async getRawData(poolAddress: string): Promise<RawPoolData> {
    // Slipstream's slot0 has six fields - no feeProtocol, unlike Uniswap V3.
    const poolAbi = [
      {
        inputs: [],
        name: 'slot0',
        outputs: [
          { internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
          { internalType: 'int24', name: 'tick', type: 'int24' },
          { internalType: 'uint16', name: 'observationIndex', type: 'uint16' },
          { internalType: 'uint16', name: 'observationCardinality', type: 'uint16' },
          { internalType: 'uint16', name: 'observationCardinalityNext', type: 'uint16' },
          { internalType: 'bool', name: 'unlocked', type: 'bool' }
        ],
        stateMutability: 'view',
        type: 'function'
      },
      {
        inputs: [],
        name: 'liquidity',
        outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
        stateMutability: 'view',
        type: 'function'
      },
      {
        inputs: [],
        name: 'token0',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function'
      },
      {
        inputs: [],
        name: 'token1',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function'
      }
    ] as const;

    try {
      const [slot0, liquidity, token0, token1] = await this.client.multicall({
        contracts: (['slot0', 'liquidity', 'token0', 'token1'] as const).map(functionName => ({
          address: poolAddress as Address,
          abi: poolAbi,
          functionName
        })),
        allowFailure: false,
        blockNumber: this.pinBlock
      }) as [any, bigint, string, string];

      return {
        sqrtPriceX96: slot0[0],
        tick: slot0[1],
        liquidity,
        token0: token0 as string,
        token1: token1 as string,
        updatedAt: Math.floor(Date.now() / 1000)
      };
    } catch (error: any) {
      if (isRpcFailure(error)) {
        throw new Error(`RPC rate limit exceeded while fetching raw data for pool ${poolAddress}`);
      }
      throw new Error(`Failed to fetch raw data for pool ${poolAddress}: ${error.message}`);
    }
  }

  async quoteSell(request: SellQuoteRequest): Promise<(bigint | null)[]> {
    const quoterAbi = [{
      inputs: [{
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' }
        ],
        internalType: 'struct IQuoterV2.QuoteExactInputSingleParams',
        name: 'params',
        type: 'tuple'
      }],
      name: 'quoteExactInputSingle',
      outputs: [
        { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
        { internalType: 'uint160', name: 'sqrtPriceX96After', type: 'uint160' },
        { internalType: 'uint32', name: 'initializedTicksCrossed', type: 'uint32' },
        { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' }
      ],
      stateMutability: 'view',
      type: 'function'
    }] as const;

    const tickSpacing = request.pool.tickSpacing;
    if (tickSpacing === undefined) return request.amountsIn.map(() => null);

    const results = await this.client.multicall({
      contracts: request.amountsIn.map(amountIn => ({
        address: this.quoterAddress,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn: request.tokenIn as Address,
          tokenOut: request.tokenOut as Address,
          amountIn,
          tickSpacing,
          sqrtPriceLimitX96: 0n
        }]
      })),
      allowFailure: true,
      blockNumber: this.pinBlock
    });

    return results.map((r: any) =>
      r?.status === 'success' && typeof r.result?.[0] === 'bigint' ? r.result[0] : null
    );
  }

  getTwapAmountOut(request: TwapRequest): Promise<TwapResult | null> {
    return readConcentratedTwap(this.client, request, this.pinBlock);
  }
}
