import { RawPoolData } from './dex_adapter';

export interface CalculationResult {
  priceInQuote: number;
  liquidityInQuote: number;
}

export class PriceCalculator {
  static calculateV2(
    reserveToken: bigint,
    reserveQuote: bigint,
    tokenDecimals: number,
    quoteDecimals: number
  ): CalculationResult {
    if (reserveToken === 0n || reserveQuote === 0n) {
      return { priceInQuote: 0, liquidityInQuote: 0 };
    }

    const rToken = Number(reserveToken) / Math.pow(10, tokenDecimals);
    const rQuote = Number(reserveQuote) / Math.pow(10, quoteDecimals);

    const priceInQuote = rQuote / rToken;
    const liquidityInQuote = rQuote * 2;

    return { priceInQuote, liquidityInQuote };
  }

  static calculateV3(
    sqrtPriceX96: bigint,
    liquidity: bigint,
    isToken0: boolean,
    tokenDecimals: number,
    quoteDecimals: number
  ): CalculationResult {
    if (sqrtPriceX96 === 0n || liquidity === 0n) {
      return { priceInQuote: 0, liquidityInQuote: 0 };
    }

    const Q96 = 2n ** 96n;
    const sqrtP = Number(sqrtPriceX96) / Number(Q96);
    let P = sqrtP * sqrtP;

    if (!isToken0) {
      P = 1 / P;
    }

    const priceInQuote = P * Math.pow(10, tokenDecimals - quoteDecimals);

    const lNum = Number(liquidity);
    let quoteReserveRaw;
    if (isToken0) {
      // Quote is token1
      quoteReserveRaw = lNum * sqrtP;
    } else {
      // Quote is token0
      quoteReserveRaw = lNum / sqrtP;
    }

    const liquidityInQuote = (quoteReserveRaw * 2) / Math.pow(10, quoteDecimals);

    return { priceInQuote, liquidityInQuote };
  }

  static calculatePoolPriceAndLiquidity(
    rawData: RawPoolData,
    isToken0: boolean,
    tokenDecimals: number,
    quoteDecimals: number
  ): CalculationResult {
    if (rawData.sqrtPriceX96 !== undefined && rawData.liquidity !== undefined) {
      return this.calculateV3(rawData.sqrtPriceX96, rawData.liquidity, isToken0, tokenDecimals, quoteDecimals);
    } else if (rawData.reserve0 !== undefined && rawData.reserve1 !== undefined) {
      const reserveToken = isToken0 ? rawData.reserve0 : rawData.reserve1;
      const reserveQuote = isToken0 ? rawData.reserve1 : rawData.reserve0;
      return this.calculateV2(reserveToken, reserveQuote, tokenDecimals, quoteDecimals);
    }
    return { priceInQuote: 0, liquidityInQuote: 0 };
  }
}
