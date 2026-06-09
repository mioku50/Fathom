import { createPublicClient, http, Address } from 'viem';
import { base } from 'viem/chains';
import { DEXAdapter, PoolInfo, RawPoolData } from '../dex_adapter';

export class AerodromeAdapter implements DEXAdapter {
  readonly id = 'aerodrome';
  private client;
  // Common quote tokens for Base (WETH, USDC)
  private quoteTokens: Address[] = [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'  // USDC
  ];

  // Aerodrome v2 factory on Base
  private factoryAddress: Address = '0x420DD381b31aEf6683db6b902084cB0FFeCE40Da';

  constructor(rpcUrl?: string) {
    this.client = createPublicClient({
      chain: base,
      transport: http(rpcUrl)
    });
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

    // Check for both volatile (false) and stable (true) pools against common quote tokens
    for (const quoteToken of this.quoteTokens) {
      if (tokenAddress.toLowerCase() === quoteToken.toLowerCase()) continue;

      for (const stable of [false, true]) {
        try {
          const poolAddress = await this.client.readContract({
            address: this.factoryAddress,
            abi: factoryAbi,
            functionName: 'getPool',
            args: [tokenAddress as Address, quoteToken as Address, stable]
          });

          if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
            pools.push({
              address: poolAddress,
              dex: 'aerodrome',
              fee: stable ? 0.0005 : 0.003 // Simplified, actual fees vary
            });
          }
        } catch (error: any) {
          if (error.message && (error.message.includes('429') || error.message.toLowerCase().includes('rate limit'))) {
            throw new Error(`RPC rate limit exceeded while checking pool for ${tokenAddress} and ${quoteToken}`);
          }
          // Ignore errors for non-existent pools
          console.error(`Error checking pool for ${tokenAddress} and ${quoteToken}:`, error);
        }
      }
    }

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
      }
    ] as const;

    try {
      const reserves = await this.client.readContract({
        address: poolAddress as Address,
        abi: poolAbi,
        functionName: 'getReserves'
      });

      return {
        reserve0: reserves[0],
        reserve1: reserves[1],
        updatedAt: Number(reserves[2])
      };
    } catch (error: any) {
      if (error.message && (error.message.includes('429') || error.message.toLowerCase().includes('rate limit'))) {
        throw new Error(`RPC rate limit exceeded while fetching raw data for pool ${poolAddress}`);
      }
      throw new Error(`Failed to fetch raw data for pool ${poolAddress}: ${error}`);
    }
  }
}
