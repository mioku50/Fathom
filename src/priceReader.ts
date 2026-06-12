import { isAddress } from 'viem';
import { DEXOrchestrator } from './orchestrator';
import { PriceCalculator } from './calculator';

export interface PriceResult {
  bestPrice: number;
  bestLiquidity: number;
  poolsCount: number;
  mainPoolData: {
    dex: string;
    address: string;
    fee?: number;
    liquidity_usd: number;
    price_usd: number;
  } | null;
}

export class PriceReader {
  constructor(private orchestrator: DEXOrchestrator) {}

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
