import { isAddress } from 'viem';
import { DEXOrchestrator } from './orchestrator';
import { PriceCalculator } from './calculator';

/**
 * Represents the result of a price and liquidity query across multiple DEXes.
 */
export interface PriceResult {
  /** The best price found across all evaluated pools, in quote token terms (usually USDC). */
  bestPrice: number;
  /** The highest liquidity available for the token across all evaluated pools, in USD. */
  bestLiquidity: number;
  /** The total number of liquidity pools evaluated for the token. */
  poolsCount: number;
  /** Detailed information about the pool offering the best price and liquidity. */
  mainPoolData: {
    /** The name of the DEX hosting the pool (e.g., UniswapV3, Aerodrome). */
    dex: string;
    /** The smart contract address of the liquidity pool. */
    address: string;
    /** The swap fee percentage of the pool, if applicable. */
    fee?: number;
    /** The total USD value of liquidity in this specific pool. */
    liquidity_usd: number;
    /** The token price in USD derived from this specific pool. */
    price_usd: number;
  } | null;
}

/**
 * A service class responsible for reading and calculating the best available price
 * and liquidity for a given token across various decentralized exchanges (DEXes).
 */
export class PriceReader {
  /**
   * Initializes the PriceReader.
   * @param orchestrator - The DEX orchestrator used to fetch pool data across multiple DEXes.
   */
  constructor(private orchestrator: DEXOrchestrator) {}

  /**
   * Queries multiple DEXes to find the best available price and the highest liquidity
   * for a specified token address.
   *
   * @param token - The smart contract address of the token to evaluate.
   * @returns A promise resolving to a PriceResult object containing the best price,
   *          highest liquidity, and details of the pool offering them.
   * @throws Will throw an error if the provided token address is invalid.
   */
  async getBestPriceAndLiquidity(token: string): Promise<PriceResult> {
    if (!token || !isAddress(token)) {
      throw new Error(`Invalid token address: ${token}`);
    }

    const pools = await this.orchestrator.getAllPools(token);
    const rawData = await this.orchestrator.getAllRawData(pools);

    let bestPrice = 0;
    let bestLiquidity = 0;
    let mainPoolData = null;

    for (const poolWithData of rawData) {
      const isToken0 = token.toLowerCase() < '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
      // Using 18 for both decimals as in index.ts
      const result = PriceCalculator.calculatePoolPriceAndLiquidity(poolWithData.rawData, isToken0, 18, 18);

      if (result.liquidityInQuote > bestLiquidity) {
        bestLiquidity = result.liquidityInQuote;
        bestPrice = result.priceInQuote;
        mainPoolData = {
          dex: poolWithData.pool.dex,
          address: poolWithData.pool.address,
          fee: poolWithData.pool.fee,
          liquidity_usd: result.liquidityInQuote,
          price_usd: result.priceInQuote
        };
      }
    }

    return {
      bestPrice,
      bestLiquidity,
      poolsCount: pools.length,
      mainPoolData
    };
  }
}
