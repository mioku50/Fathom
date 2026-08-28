import { Address } from 'viem';
import { DEXAdapter, PoolInfo, RawPoolData } from '../dex_adapter';
import { PriceRpcClient, isRpcFailure } from '../utils/price_rpc';

export class UniswapV3Adapter implements DEXAdapter {
  readonly id = 'uniswap_v3';
  private client: PriceRpcClient;
  // Common quote tokens for Base (WETH, USDC)
  private quoteTokens: Address[] = [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'  // USDC
  ];

  // Uniswap V3 factory on Base
  private factoryAddress: Address = '0x33128a8fc17869897dce68ed026d694621f6fdfd';

  // Standard Uniswap V3 fee tiers
  private feeTiers = [100, 500, 3000, 10000];

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
    // ABI for Uniswap V3 Factory getPool
    const factoryAbi = [
      {
        inputs: [
          { internalType: "address", name: "", type: "address" },
          { internalType: "address", name: "", type: "address" },
          { internalType: "uint24", name: "", type: "uint24" }
        ],
        name: "getPool",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      }
    ] as const;

    // One multicall instead of one round trip per (quote, fee tier) pair.
    // This used to be 8 sequential eth_calls per token, which dominated latency
    // and pushed large batches toward the Workers subrequest limit.
    const probes: { quoteToken: Address; fee: number }[] = [];
    for (const quoteToken of this.quoteTokens) {
      if (tokenAddress.toLowerCase() === quoteToken.toLowerCase()) continue;
      for (const fee of this.feeTiers) {
        probes.push({ quoteToken, fee });
      }
    }

    if (probes.length === 0) return [];

    let results: any[];
    try {
      results = await this.client.multicall({
        contracts: probes.map(({ quoteToken, fee }) => ({
          address: this.factoryAddress,
          abi: factoryAbi,
          functionName: 'getPool',
          args: [tokenAddress as Address, quoteToken, fee]
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
    results.forEach((result, i) => {
      const { quoteToken, fee } = probes[i];
      if (result?.status !== 'success') {
        // A reverting probe just means the pool does not exist.
        console.error(`Error checking pool for ${tokenAddress} and ${quoteToken} at fee ${fee}:`, result?.error?.message);
        return;
      }
      const poolAddress = result.result;
      if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
        pools.push({
          address: poolAddress,
          dex: 'uniswap_v3',
          fee: fee / 1000000 // Format to decimal like 0.0005 for 500
        });
      }
    });

    return pools;
  }

  async getRawData(poolAddress: string): Promise<RawPoolData> {
    // ABI for Uniswap V3 Pool slot0 and liquidity
    const poolAbi = [
      {
        inputs: [],
        name: "slot0",
        outputs: [
          { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
          { internalType: "int24", name: "tick", type: "int24" },
          { internalType: "uint16", name: "observationIndex", type: "uint16" },
          { internalType: "uint16", name: "observationCardinality", type: "uint16" },
          { internalType: "uint16", name: "observationCardinalityNext", type: "uint16" },
          { internalType: "uint8", name: "feeProtocol", type: "uint8" },
          { internalType: "bool", name: "unlocked", type: "bool" }
        ],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "liquidity",
        outputs: [{ internalType: "uint128", name: "", type: "uint128" }],
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
      // Single round trip; also guarantees all four reads share one block.
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
        liquidity: liquidity,
        token0: token0 as string,
        token1: token1 as string,
        updatedAt: Math.floor(Date.now() / 1000) // slot0 doesn't have a timestamp, use current time
      };
    } catch (error: any) {
      if (isRpcFailure(error)) {
        throw new Error(`RPC rate limit exceeded while fetching raw data for pool ${poolAddress}`);
      }
      throw new Error(`Failed to fetch raw data for pool ${poolAddress}: ${error.message}`);
    }
  }
}
