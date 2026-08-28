import { describe, it, expect } from 'vitest';
import {
  constantProductSellQuote,
  constantProductDepth,
  constantProductDepthProfile,
  unknownDepth,
  SELL_QUOTE_SIZES_USD
} from '../src/depth';

// 1,000,000 TOKEN <-> 1,000,000 USDC  => spot $1.00, 30 bps fee
const pool = { reserveToken: 1_000_000, reserveQuote: 1_000_000, quoteUsdPrice: 1, fee: 0.003 };

describe('constantProductSellQuote', () => {
  it('matches the exact x*y=k output a router would return', () => {
    const q = constantProductSellQuote(pool, 10_000);

    // dx = 10000 tokens, dx' = 9970, dy = 1e6*9970/(1e6+9970)
    const expected = (1_000_000 * 9970) / (1_000_000 + 9970);
    expect(q.proceeds_usd).toBeCloseTo(expected, 6);
    expect(q.execution_price_usd).toBeCloseTo(expected / 10_000, 9);
  });

  it('charges more impact for a larger sale', () => {
    const small = constantProductSellQuote(pool, 1_000);
    const large = constantProductSellQuote(pool, 10_000);

    expect(small.price_impact_bps!).toBeGreaterThan(0);
    expect(large.price_impact_bps!).toBeGreaterThan(small.price_impact_bps!);
    // proceeds grow sublinearly: 10x the size returns less than 10x the money
    expect(large.proceeds_usd!).toBeLessThan(small.proceeds_usd! * 10);
  });

  it('never returns more than the pool holds, even for an absurd sale', () => {
    const q = constantProductSellQuote(pool, 1_000_000_000);
    expect(q.proceeds_usd!).toBeLessThan(pool.reserveQuote);
  });

  it('prices through a non-USD quote token', () => {
    // 1000 TOKEN <-> 10 WETH at $3000 => spot $30
    const wethPool = { reserveToken: 1000, reserveQuote: 10, quoteUsdPrice: 3000, fee: 0.003 };
    const q = constantProductSellQuote(wethPool, 300);

    // $300 at spot $30 = 10 tokens in
    const dxAfterFee = 10 * 0.997;
    const expectedWeth = (10 * dxAfterFee) / (1000 + dxAfterFee);
    expect(q.proceeds_usd).toBeCloseTo(expectedWeth * 3000, 6);
  });

  it('reports nothing rather than guessing on unusable input', () => {
    for (const bad of [
      { ...pool, reserveToken: 0 },
      { ...pool, reserveQuote: 0 },
      { ...pool, quoteUsdPrice: 0 },
      { ...pool, fee: 1 },
      { ...pool, reserveToken: NaN }
    ]) {
      const q = constantProductSellQuote(bad, 1000);
      expect(q.proceeds_usd).toBeNull();
      expect(q.price_impact_bps).toBeNull();
    }

    expect(constantProductSellQuote(pool, 0).proceeds_usd).toBeNull();
    expect(constantProductSellQuote(pool, -5).proceeds_usd).toBeNull();
  });
});

describe('constantProductDepth', () => {
  it('finds the notional that moves the marginal price by the given amount', () => {
    const depth = constantProductDepth(pool, 0.01)!;

    // selling `depth` USD should leave the marginal price ~1% lower
    const amountIn = depth / 1;            // spot is $1
    const amountInAfterFee = amountIn * (1 - pool.fee);
    const marginalAfter =
      (pool.reserveQuote * pool.reserveToken) /
      Math.pow(pool.reserveToken + amountInAfterFee, 2);

    expect(marginalAfter).toBeCloseTo(0.99, 6);
  });

  it('needs a larger notional to move the price further', () => {
    expect(constantProductDepth(pool, 0.05)!).toBeGreaterThan(constantProductDepth(pool, 0.01)!);
  });

  it('scales with pool size', () => {
    const deep = { ...pool, reserveToken: 10_000_000, reserveQuote: 10_000_000 };
    expect(constantProductDepth(deep, 0.01)!).toBeCloseTo(constantProductDepth(pool, 0.01)! * 10, 6);
  });

  it('rejects nonsensical drops', () => {
    expect(constantProductDepth(pool, 0)).toBeNull();
    expect(constantProductDepth(pool, 1)).toBeNull();
    expect(constantProductDepth(pool, -0.1)).toBeNull();
  });
});

describe('depth profiles', () => {
  it('quotes every advertised size', () => {
    const profile = constantProductDepthProfile(pool);
    expect(profile.sell_quotes.map(q => q.size_usd)).toEqual([...SELL_QUOTE_SIZES_USD]);
    expect(profile.sell_quotes.every(q => q.proceeds_usd !== null)).toBe(true);
    expect(profile.depth_1pct_usd).not.toBeNull();
    expect(profile.depth_5pct_usd).not.toBeNull();
  });

  it('unknownDepth states ignorance explicitly instead of returning zeros', () => {
    const unknown = unknownDepth();
    expect(unknown.depth_1pct_usd).toBeNull();
    expect(unknown.depth_5pct_usd).toBeNull();
    expect(unknown.sell_quotes).toHaveLength(SELL_QUOTE_SIZES_USD.length);
    for (const q of unknown.sell_quotes) {
      expect(q.proceeds_usd).toBeNull();
      expect(q.execution_price_usd).toBeNull();
      expect(q.price_impact_bps).toBeNull();
    }
  });
});
