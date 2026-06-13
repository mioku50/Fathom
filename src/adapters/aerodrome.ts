import { Address } from 'viem';
import { DEXAdapter, PoolInfo, RawPoolData } from '../dex_adapter';
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

  private pinBlock?: bigint;

  constructor(rpcUrl: string, fallbackUrlsStr?: string, pinBlock?: string) {
    if (pinBlock && pinBlock !== 'latest') {
      this.pinBlock = BigInt(pinBlock);
    }
    this.client = new PriceRpcClient(rpcUrl, fallbackUrlsStr);
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
            args: [tokenAddress as Address, quoteToken as Address, stable],
            blockNumber: this.pinBlock
          });

          if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
            pools.push({
              address: poolAddress,
              dex: 'aerodrome',
              fee: stable ? 0.0005 : 0.003 // Simplified, actual fees vary
            });
          }
        } catch (error: any) {
          if (isRpcFailure(error)) {
            console.error('RPC FAILURE DETAILS:', error);
            throw new Error(`RPC rate limit exceeded while checking pool for ${tokenAddress} and ${quoteToken}`);
          }
          // Ignore errors for non-existent pools
          console.error(`Error checking pool for ${tokenAddress} and ${quoteToken}:`, error.message);
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
      const [reserves, token0, token1] = await Promise.all([
        this.client.readContract({
          address: poolAddress as Address,
          abi: poolAbi,
          functionName: 'getReserves',
          blockNumber: this.pinBlock
        }),
        this.client.readContract({
          address: poolAddress as Address,
          abi: poolAbi,
          functionName: 'token0',
          blockNumber: this.pinBlock
        }),
        this.client.readContract({
          address: poolAddress as Address,
          abi: poolAbi,
          functionName: 'token1',
          blockNumber: this.pinBlock
        })
      ]);

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
}
