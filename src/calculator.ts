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

  /**
   * Aerodrome stable pools trade on x3y + y3x = k, not on x * y = k.
   *
   * The marginal price is the ratio of the curve's partials,
   *
   *   dy/dx = (3x^2*y + y^3) / (x^3 + 3x*y^2)
   *
   * which the reserve ratio y/x approximates only at perfect balance. The two
   * diverge fast: at a 55:45 skew the reserve ratio is already 18% off, and at
   * 70:30 it is more than half. Pricing a stable pool by its reserve ratio is
   * therefore wrong nearly always, and most wrong exactly when the pool is
   * skewed - which is when a price is worth having.
   *
   * Both reserves arrive decimal-normalised, which is the same normalisation
   * the pool applies internally, so the result is quote-per-token directly.
   */
  static calculateAerodromeStable(
    reserveToken: bigint,
    reserveQuote: bigint,
    tokenDecimals: number,
    quoteDecimals: number
  ): CalculationResult {
    if (reserveToken === 0n || reserveQuote === 0n) {
      return { priceInQuote: 0, liquidityInQuote: 0 };
    }

    const x = Number(reserveToken) / Math.pow(10, tokenDecimals);
    const y = Number(reserveQuote) / Math.pow(10, quoteDecimals);
    if (!(x > 0) || !(y > 0)) {
      return { priceInQuote: 0, liquidityInQuote: 0 };
    }

    const numerator = 3 * x * x * y + y * y * y;
    const denominator = x * x * x + 3 * x * y * y;
    if (!(denominator > 0) || !Number.isFinite(numerator / denominator)) {
      return { priceInQuote: 0, liquidityInQuote: 0 };
    }

    const priceInQuote = numerator / denominator;

    // Value both sides at the curve's own price. For constant product this
    // reduces to rQuote * 2; for the stable curve it does not, because the
    // reserves are not equal in value away from balance.
    const liquidityInQuote = y + x * priceInQuote;

    return { priceInQuote, liquidityInQuote };
  }

  static calculatePoolPriceAndLiquidity(
    rawData: RawPoolData,
    isToken0: boolean,
    tokenDecimals: number,
    quoteDecimals: number,
    /**
     * True for Aerodrome stable pools. Routing on the presence of reserves
     * alone sent them through the constant-product path, which is a different
     * curve and therefore a different price.
     */
    stable: boolean = false
  ): CalculationResult {
    if (rawData.sqrtPriceX96 !== undefined && rawData.liquidity !== undefined) {
      return this.calculateV3(rawData.sqrtPriceX96, rawData.liquidity, isToken0, tokenDecimals, quoteDecimals);
    } else if (rawData.reserve0 !== undefined && rawData.reserve1 !== undefined) {
      const reserveToken = isToken0 ? rawData.reserve0 : rawData.reserve1;
      const reserveQuote = isToken0 ? rawData.reserve1 : rawData.reserve0;
      return stable
        ? this.calculateAerodromeStable(reserveToken, reserveQuote, tokenDecimals, quoteDecimals)
        : this.calculateV2(reserveToken, reserveQuote, tokenDecimals, quoteDecimals);
    }
    return { priceInQuote: 0, liquidityInQuote: 0 };
  }
}
