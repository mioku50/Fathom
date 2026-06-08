import { createPublicClient, http, Address } from 'viem';
import { base } from 'viem/chains';
import { DEXAdapter, PoolInfo, RawPoolData } from '../dex_adapter';

export class UniswapV2Adapter implements DEXAdapter {
  private client;
  // Common quote tokens for Base (WETH, USDC)
  private quoteTokens: Address[] = [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'  // USDC
  ];

  // Uniswap V2 factory on Base
  private factoryAddress: Address = '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC4';

  constructor(rpcUrl?: string) {
    this.client = createPublicClient({
      chain: base,
      transport: http(rpcUrl)
    });
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

    for (const quoteToken of this.quoteTokens) {
      if (tokenAddress.toLowerCase() === quoteToken.toLowerCase()) continue;

      try {
        const poolAddress = await this.client.readContract({
          address: this.factoryAddress,
          abi: factoryAbi,
          functionName: 'getPair',
          args: [tokenAddress as Address, quoteToken as Address]
        });

        if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
          pools.push({
            address: poolAddress,
            dex: 'uniswap_v2',
            fee: 0.003 // Standard Uniswap V2 fee is 0.3%
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
      }
    ] as const;

    try {
      const reserves = await this.client.readContract({
        address: poolAddress as Address,
        abi: poolAbi,
        functionName: 'getReserves'
      });

      return {
        reserve0: BigInt(reserves[0]),
        reserve1: BigInt(reserves[1]),
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
