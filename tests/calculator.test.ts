import { describe, it, expect } from 'vitest';
import { PriceCalculator } from '../src/calculator';
import { RawPoolData } from '../src/dex_adapter';

describe('PriceCalculator', () => {
  describe('calculateV2', () => {
    it('should calculate V2 price and liquidity correctly (Token=18, Quote=6)', () => {
      // 1 Token (18 dec) = 2 Quote (6 dec)
      const reserveToken = 1000000000000000000n; // 1
      const reserveQuote = 2000000n; // 2

      const result = PriceCalculator.calculateV2(reserveToken, reserveQuote, 18, 6);
      expect(result.priceInQuote).toBeCloseTo(2);
      expect(result.liquidityInQuote).toBeCloseTo(4); // 2 * 2
    });

    it('should return 0 if reserves are 0', () => {
      const result1 = PriceCalculator.calculateV2(0n, 100n, 18, 6);
      const result2 = PriceCalculator.calculateV2(100n, 0n, 18, 6);

      expect(result1).toEqual({ priceInQuote: 0, liquidityInQuote: 0 });
      expect(result2).toEqual({ priceInQuote: 0, liquidityInQuote: 0 });
    });
  });

  describe('calculateV3', () => {
    it('should calculate V3 price and liquidity correctly when token is token0 (1:1 ratio)', () => {
      // sqrtPriceX96 for 1:1 ratio is 2^96
      const sqrtPriceX96 = 79228162514264337593543950336n;
      // Liquidity corresponding to 1 token
      const liquidity = 1000000n;

      // Both 18 decimals
      const result = PriceCalculator.calculateV3(sqrtPriceX96, liquidity, true, 18, 18);

      expect(result.priceInQuote).toBeCloseTo(1);
    });

    it('should calculate V3 price and liquidity correctly when token is token1 (1:1 ratio)', () => {
      const sqrtPriceX96 = 79228162514264337593543950336n;
      const liquidity = 1000000n;

      // Both 18 decimals
      const result = PriceCalculator.calculateV3(sqrtPriceX96, liquidity, false, 18, 18);

      expect(result.priceInQuote).toBeCloseTo(1);
    });

    it('should calculate V3 price when token is token0 and token=18, quote=6', () => {
      // ratio 1:1 unadjusted, so token0/token1 = 1
      const sqrtPriceX96 = 79228162514264337593543950336n;
      const liquidity = 1000000n;

      const result = PriceCalculator.calculateV3(sqrtPriceX96, liquidity, true, 18, 6);

      // Price = 1 * 10^(18-6) = 10^12
      expect(result.priceInQuote).toBeCloseTo(1e12);
    });

    it('should return 0 if sqrtPriceX96 or liquidity is 0', () => {
      const result1 = PriceCalculator.calculateV3(0n, 100n, true, 18, 6);
      const result2 = PriceCalculator.calculateV3(100n, 0n, true, 18, 6);

      expect(result1).toEqual({ priceInQuote: 0, liquidityInQuote: 0 });
      expect(result2).toEqual({ priceInQuote: 0, liquidityInQuote: 0 });
    });
  });

  describe('calculatePoolPriceAndLiquidity', () => {
    it('should route to V3 calculation if V3 fields exist', () => {
      const rawData: RawPoolData = {
        sqrtPriceX96: 79228162514264337593543950336n,
        liquidity: 1000000n,
        updatedAt: 0
      };

      const result = PriceCalculator.calculatePoolPriceAndLiquidity(rawData, true, 18, 18);
      expect(result.priceInQuote).toBeCloseTo(1);
    });

    it('should route to V2 calculation if V2 fields exist (isToken0=true)', () => {
      const rawData: RawPoolData = {
        reserve0: 1000000000000000000n, // Token
        reserve1: 2000000n, // Quote
        updatedAt: 0
      };

      const result = PriceCalculator.calculatePoolPriceAndLiquidity(rawData, true, 18, 6);
      expect(result.priceInQuote).toBeCloseTo(2);
      expect(result.liquidityInQuote).toBeCloseTo(4);
    });

    it('should route to V2 calculation if V2 fields exist (isToken0=false)', () => {
      const rawData: RawPoolData = {
        reserve0: 2000000n, // Quote
        reserve1: 1000000000000000000n, // Token
        updatedAt: 0
      };

      const result = PriceCalculator.calculatePoolPriceAndLiquidity(rawData, false, 18, 6);
      expect(result.priceInQuote).toBeCloseTo(2);
      expect(result.liquidityInQuote).toBeCloseTo(4);
    });

    it('should return 0 if neither V2 nor V3 fields exist', () => {
      const rawData: RawPoolData = {
        updatedAt: 0
      };

      const result = PriceCalculator.calculatePoolPriceAndLiquidity(rawData, true, 18, 6);
      expect(result).toEqual({ priceInQuote: 0, liquidityInQuote: 0 });
    });
  });
});
