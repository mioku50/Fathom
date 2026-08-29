import { describe, it, expect } from 'vitest';
import { PriceCalculator } from '../src/calculator';

/**
 * Aerodrome stable pools trade on x3y + y3x = k. Routing them through the
 * constant-product path - which is what the presence of reserves used to
 * imply - prices them by the reserve ratio, a different curve entirely.
 */
describe('Aerodrome stable curve', () => {
  const e18 = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

  it('agrees with the reserve ratio only at perfect balance', () => {
    const balanced = PriceCalculator.calculateAerodromeStable(e18(100), e18(100), 18, 18);
    expect(balanced.priceInQuote).toBeCloseTo(1, 12);
  });

  it('holds price near par where the reserve ratio has already collapsed', () => {
    // 55:45 is an unremarkable skew for a working stable pool.
    const stable = PriceCalculator.calculateAerodromeStable(e18(55), e18(45), 18, 18);
    const asConstantProduct = PriceCalculator.calculateV2(e18(55), e18(45), 18, 18);

    // The true stable price barely moves...
    expect(stable.priceInQuote).toBeGreaterThan(0.99);
    // ...while the reserve ratio is already 18% away from it.
    expect(asConstantProduct.priceInQuote).toBeCloseTo(0.8182, 3);
    const errorBps = (asConstantProduct.priceInQuote / stable.priceInQuote - 1) * 10000;
    expect(errorBps).toBeLessThan(-1700);
  });

  it('stays bounded under heavy skew, unlike the reserve ratio', () => {
    const stable = PriceCalculator.calculateAerodromeStable(e18(80), e18(20), 18, 18);
    const asConstantProduct = PriceCalculator.calculateV2(e18(80), e18(20), 18, 18);

    expect(stable.priceInQuote).toBeCloseTo(0.6447, 3);
    expect(asConstantProduct.priceInQuote).toBeCloseTo(0.25, 6);
  });

  it('handles a 6-decimal quote asset without rescaling the price', () => {
    const reserveToken = e18(1000);
    const reserveQuote = 1000n * 10n ** 6n; // 1000 USDC
    const result = PriceCalculator.calculateAerodromeStable(reserveToken, reserveQuote, 18, 6);
    expect(result.priceInQuote).toBeCloseTo(1, 9);
  });

  it('values both sides at the curve price rather than doubling one', () => {
    // Away from balance the two sides are not worth the same, so rQuote * 2 -
    // correct for constant product - overstates or understates the pool.
    const { priceInQuote, liquidityInQuote } = PriceCalculator.calculateAerodromeStable(
      e18(80), e18(20), 18, 18
    );
    expect(liquidityInQuote).toBeCloseTo(20 + 80 * priceInQuote, 6);
    expect(liquidityInQuote).not.toBeCloseTo(40, 1);
  });

  it('returns nothing rather than a number for an empty pool', () => {
    expect(PriceCalculator.calculateAerodromeStable(0n, e18(10), 18, 18)).toEqual({
      priceInQuote: 0,
      liquidityInQuote: 0
    });
  });

  it('routes on the stable flag, not on the presence of reserves', () => {
    const raw = { reserve0: e18(55), reserve1: e18(45), updatedAt: 1 };

    const asStable = PriceCalculator.calculatePoolPriceAndLiquidity(raw, true, 18, 18, true);
    const asVolatile = PriceCalculator.calculatePoolPriceAndLiquidity(raw, true, 18, 18, false);

    expect(asStable.priceInQuote).toBeGreaterThan(0.99);
    expect(asVolatile.priceInQuote).toBeCloseTo(0.8182, 3);
    // Defaulting to volatile keeps every existing constant-product caller intact.
    expect(PriceCalculator.calculatePoolPriceAndLiquidity(raw, true, 18, 18).priceInQuote).toBe(
      asVolatile.priceInQuote
    );
  });
});
