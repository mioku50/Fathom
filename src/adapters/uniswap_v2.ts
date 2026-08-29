import { Address } from 'viem';
import { DEXAdapter, PoolInfo, RawPoolData } from '../dex_adapter';
import { PriceRpcClient, isRpcFailure } from '../utils/price_rpc';
import { readPoolsBatch } from './batch_read';

export class UniswapV2Adapter implements DEXAdapter {
  readonly id = 'uniswap_v2';
  private client: PriceRpcClient;
  // Common quote tokens for Base (WETH, USDC)
  private quoteTokens: Address[] = [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0x940181a94a35a4569e4529a3cdfb74e38fd98631'  // AERO
  ];

  // Uniswap V2 factory on Base
  private factoryAddress: Address = '0x8909dc15e40173ff4699343b6eb8132c65e18ec4';

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

    // ABI for Uniswap V2 Factory getPair
    const factoryAbi = [
      {
        inputs: [
          { internalType: "address", name: "", type: "address" },
          { internalType: "address", name: "", type: "address" }
        ],
        name: "getPair",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      }
    ] as const;

    // One multicall for every quote token instead of a round trip each.
    const probes: Address[] = this.quoteTokens.filter(
      q => tokenAddress.toLowerCase() !== q.toLowerCase()
    );

    if (probes.length === 0) return [];

    let results: any[];
    try {
      results = await this.client.multicall({
        contracts: probes.map(quoteToken => ({
          address: this.factoryAddress,
          abi: factoryAbi,
          functionName: 'getPair',
          args: [tokenAddress as Address, quoteToken]
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
      const quoteToken = probes[i];
      if (result?.status !== 'success') {
        console.error(`Error checking pool for ${tokenAddress} and ${quoteToken}:`, result?.error?.message);
        return;
      }
      const poolAddress = result.result;
      if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
        pools.push({
          address: poolAddress,
          dex: 'uniswap_v2',
          fee: 0.003 // Standard Uniswap V2 fee is 0.3%
        });
      }
    });

    return pools;
  }

  async getRawData(poolAddress: string): Promise<RawPoolData> {
    // ABI for Uniswap V2 Pool getReserves
    const poolAbi = [
      {
        inputs: [],
        name: "getReserves",
        outputs: [
          { internalType: "uint112", name: "_reserve0", type: "uint112" },
          { internalType: "uint112", name: "_reserve1", type: "uint112" },
          { internalType: "uint32", name: "_blockTimestampLast", type: "uint32" }
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
        reserve0: BigInt(reserves[0]),
        reserve1: BigInt(reserves[1]),
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

  async getRawDataBatch(pools: PoolInfo[]): Promise<(RawPoolData | null)[]> {
    const poolAbi = [
      { inputs: [], name: 'getReserves', outputs: [
          { internalType: 'uint112', name: '_reserve0', type: 'uint112' },
          { internalType: 'uint112', name: '_reserve1', type: 'uint112' },
          { internalType: 'uint32', name: '_blockTimestampLast', type: 'uint32' }
        ], stateMutability: 'view', type: 'function' },
      { inputs: [], name: 'token0', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
      { inputs: [], name: 'token1', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' }
    ] as const;

    const rows = await readPoolsBatch(
      this.client, pools.map(p => p.address), poolAbi,
      ['getReserves', 'token0', 'token1'], this.pinBlock
    );

    return rows.map(row => row === null ? null : {
      reserve0: BigInt(row[0][0]),
      reserve1: BigInt(row[0][1]),
      token0: row[1] as string,
      token1: row[2] as string,
      updatedAt: Number(row[0][2])
    });
  }
}
