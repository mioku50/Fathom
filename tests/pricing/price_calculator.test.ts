import { describe, it, expect } from 'vitest';
import { PriceCalculator } from '../../src/calculator';
import { RawPoolData } from '../../src/dex_adapter';

describe('PriceCalculator Edge Cases in calculatePoolPriceAndLiquidity', () => {
  it('should return 0 when V3 inputs have missing values', () => {
    // Missing liquidity
    const rawData1: RawPoolData = {
      sqrtPriceX96: 79228162514264337593543950336n,
      updatedAt: 0
    };

    // Missing sqrtPriceX96
    const rawData2: RawPoolData = {
      liquidity: 1000000n,
      updatedAt: 0
    };

    expect(PriceCalculator.calculatePoolPriceAndLiquidity(rawData1, true, 18, 18)).toEqual({ priceInQuote: 0, liquidityInQuote: 0 });
    expect(PriceCalculator.calculatePoolPriceAndLiquidity(rawData2, true, 18, 18)).toEqual({ priceInQuote: 0, liquidityInQuote: 0 });
  });

  it('should return 0 when V2 inputs have missing values', () => {
    // Missing reserve1
    const rawData1: RawPoolData = {
      reserve0: 100000n,
      updatedAt: 0
    };

    // Missing reserve0
    const rawData2: RawPoolData = {
      reserve1: 100000n,
      updatedAt: 0
    };

    expect(PriceCalculator.calculatePoolPriceAndLiquidity(rawData1, true, 18, 18)).toEqual({ priceInQuote: 0, liquidityInQuote: 0 });
    expect(PriceCalculator.calculatePoolPriceAndLiquidity(rawData2, true, 18, 18)).toEqual({ priceInQuote: 0, liquidityInQuote: 0 });
  });

  it('should prioritize V3 over V2 if both sets of fields exist', () => {
    const rawData: RawPoolData = {
      sqrtPriceX96: 79228162514264337593543950336n, // Ratio 1:1
      liquidity: 1000000n,
      reserve0: 1000000000000000000n, // Token
      reserve1: 2000000n, // Quote (would be price 2)
      updatedAt: 0
    };

    // If it correctly chooses V3, the price should be 1, not 2
    const result = PriceCalculator.calculatePoolPriceAndLiquidity(rawData, true, 18, 18);
    expect(result.priceInQuote).toBeCloseTo(1);
  });

  it('should handle Infinity safely in V3', () => {
    // Max values for sqrtPriceX96
    const maxSqrtPriceX96 = 1461501637330902918203684832716283019655932542975n;
    const result = PriceCalculator.calculateV3(maxSqrtPriceX96, 10n, true, 18, 18);
    expect(result.priceInQuote).toBeGreaterThan(0);
  });

  it('should handle zero decimals safely in V2', () => {
    const reserveToken = 100n;
    const reserveQuote = 200n;

    // Both decimals zero => div by 1
    const result = PriceCalculator.calculateV2(reserveToken, reserveQuote, 0, 0);
    expect(result.priceInQuote).toBeCloseTo(2);
    expect(result.liquidityInQuote).toBeCloseTo(400); // rQuote * 2 = 200 * 2 = 400
  });

  it('should handle zero decimals safely in V3', () => {
    const sqrtPriceX96 = 79228162514264337593543950336n; // 1:1 ratio
    const liquidity = 10n; // arbitrary small liquidity

    const result = PriceCalculator.calculateV3(sqrtPriceX96, liquidity, true, 0, 0);
    expect(result.priceInQuote).toBeCloseTo(1);
    expect(result.liquidityInQuote).toBeCloseTo(20); // Quote Reserve raw * 2 = 10 * 1 * 2 = 20
  });

});
