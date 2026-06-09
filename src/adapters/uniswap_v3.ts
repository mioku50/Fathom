import { createPublicClient, http, Address } from 'viem';
import { base } from 'viem/chains';
import { DEXAdapter, PoolInfo, RawPoolData } from '../dex_adapter';

export class UniswapV3Adapter implements DEXAdapter {
  readonly id = 'uniswap_v3';
  private client;
  // Common quote tokens for Base (WETH, USDC)
  private quoteTokens: Address[] = [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'  // USDC
  ];

  // Uniswap V3 factory on Base
  private factoryAddress: Address = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

  // Standard Uniswap V3 fee tiers
  private feeTiers = [100, 500, 3000, 10000];

  constructor(rpcUrl?: string) {
    this.client = createPublicClient({
      chain: base,
      transport: http(rpcUrl)
    });
  }

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = [];

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

    for (const quoteToken of this.quoteTokens) {
      if (tokenAddress.toLowerCase() === quoteToken.toLowerCase()) continue;

      for (const fee of this.feeTiers) {
        try {
          const poolAddress = await this.client.readContract({
            address: this.factoryAddress,
            abi: factoryAbi,
            functionName: 'getPool',
            args: [tokenAddress as Address, quoteToken as Address, fee]
          });

          if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
            pools.push({
              address: poolAddress,
              dex: 'uniswap_v3',
              fee: fee / 1000000 // Format to decimal like 0.0005 for 500
            });
          }
        } catch (error: any) {
          if (error.message && (error.message.includes('429') || error.message.toLowerCase().includes('rate limit'))) {
            throw new Error(`RPC rate limit exceeded while checking pool for ${tokenAddress} and ${quoteToken} at fee ${fee}`);
          }
          // Ignore errors for non-existent pools
          console.error(`Error checking pool for ${tokenAddress} and ${quoteToken} at fee ${fee}:`, error);
        }
      }
    }

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
      }
    ] as const;

    try {
      const [slot0, liquidity] = await Promise.all([
        this.client.readContract({
          address: poolAddress as Address,
          abi: poolAbi,
          functionName: 'slot0'
        }),
        this.client.readContract({
          address: poolAddress as Address,
          abi: poolAbi,
          functionName: 'liquidity'
        })
      ]);

      return {
        sqrtPriceX96: slot0[0],
        tick: slot0[1],
        liquidity: liquidity,
        updatedAt: Math.floor(Date.now() / 1000) // slot0 doesn't have a timestamp, use current time
      };
    } catch (error: any) {
      if (error.message && (error.message.includes('429') || error.message.toLowerCase().includes('rate limit'))) {
        throw new Error(`RPC rate limit exceeded while fetching raw data for pool ${poolAddress}`);
      }
      throw new Error(`Failed to fetch raw data for pool ${poolAddress}: ${error}`);
    }
  }
}
