import { describe, it, expect, vi } from 'vitest';
import { readStockReference, PREMIUM_NOTABLE_BPS } from '../../src/b20/reference';

const TSLAC = '0xb2000000000000000000001e800a7f5189430cD0';
const GOOGLC = '0xb2000000000000000000002D0BA3164cc74f58B7';
const AERO = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';
const NOW = 1_789_483_490;

/** `latestRoundData()` as viem decodes it: a positional tuple. */
function feed(priceUsd: number, updatedAt: number = NOW - 60) {
  return {
    multicall: vi.fn(async () => [
      {
        status: 'success',
        result: [1n, BigInt(Math.round(priceUsd * 1e8)), BigInt(updatedAt), BigInt(updatedAt), 1n]
      }
    ])
  };
}

describe('stock reference', () => {
  it('ignores a token that is not a verified Coinbase stock', async () => {
    const rpc = feed(100);
    const { reference, flags } = await readStockReference(rpc as any, AERO, 100, NOW);

    expect(reference.reference_price_usd).toBeNull();
    expect(flags).toEqual([]);
    expect(rpc.multicall).not.toHaveBeenCalled();
  });

  it('reads the feed and prices Fathom’s measurement against it', async () => {
    // The live pair on 2026-09-15: AAPLc measured at 330.08 against a reference
    // of 329.64, which is +13.6 bps.
    const { reference, flags } = await readStockReference(
      feed(329.64) as any,
      '0xb200000000000000000000C2e324d24d7eEcd1fb',
      330.08,
      NOW
    );

    expect(reference.reference_price_usd).toBeCloseTo(329.64, 2);
    expect(reference.premium_discount_bps).toBeCloseTo(13.3, 0);
    expect(reference.source).toBe('chainlink');
    expect(reference.age_seconds).toBe(60);
    expect(flags).toEqual([]);
  });

  it('signs a discount negative', async () => {
    const { reference } = await readStockReference(feed(213.03) as any, '0xb20000000000000000000078ee7ce2fE4908108C', 212.80, NOW);
    expect(reference.premium_discount_bps).toBeLessThan(0);
    expect(reference.premium_discount_bps).toBeCloseTo(-10.8, 0);
  });

  it('does not apply the multiplier to the reference a second time', async () => {
    // Chainlink publishes total return, which is underlying x multiplier, so it
    // already IS the token price. GOOGLc's multiplier is 1.000377; if the layer
    // re-applied it, a token trading exactly at the reference would show a
    // 3.77 bps premium out of nowhere.
    const { reference } = await readStockReference(feed(345.15) as any, GOOGLC, 345.15, NOW);
    expect(reference.premium_discount_bps).toBe(0);
  });

  it('flags a premium past the arbitrage floor', async () => {
    const { reference, flags } = await readStockReference(feed(100) as any, TSLAC, 102, NOW);
    expect(reference.premium_discount_bps).toBeCloseTo(200, 0);
    expect(flags).toContain('stock_premium_high');
    expect(flags).not.toContain('stock_discount_high');
  });

  it('flags a discount past the arbitrage floor', async () => {
    const { flags } = await readStockReference(feed(100) as any, TSLAC, 97, NOW);
    expect(flags).toContain('stock_discount_high');
  });

  it('leaves an ordinary deviation unflagged', async () => {
    const justInside = 100 * (1 + (PREMIUM_NOTABLE_BPS - 1) / 10_000);
    const { flags } = await readStockReference(feed(100) as any, TSLAC, justInside, NOW);
    expect(flags).not.toContain('stock_premium_high');
  });

  it('records a frozen feed without turning it into a finding about the token', async () => {
    // Nights, weekends and holidays freeze the feed by design.
    const threeDays = NOW - 3 * 24 * 60 * 60;
    const { reference, flags } = await readStockReference(feed(100, threeDays) as any, TSLAC, 101, NOW);

    expect(flags).toContain('reference_price_stale');
    // Still computed: a premium against Friday's close is exactly what a weekend
    // seller wants, provided the age is stated.
    expect(reference.premium_discount_bps).toBeCloseTo(100, 0);
    expect(reference.age_seconds).toBe(3 * 24 * 60 * 60);
  });

  it('returns no reference when the feed cannot be read', async () => {
    const rpc = { multicall: vi.fn(async () => [{ status: 'failure', error: new Error('reverted') }]) };
    const { reference, flags } = await readStockReference(rpc as any, TSLAC, 100, NOW);

    expect(reference.reference_price_usd).toBeNull();
    expect(reference.premium_discount_bps).toBeNull();
    expect(flags).toContain('reference_price_unavailable');
  });

  it('rejects a non-positive answer rather than dividing by it', async () => {
    const rpc = { multicall: vi.fn(async () => [{ status: 'success', result: [1n, 0n, 1n, 1n, 1n] }]) };
    const { reference, flags } = await readStockReference(rpc as any, TSLAC, 100, NOW);

    expect(reference.reference_price_usd).toBeNull();
    expect(flags).toContain('reference_price_unavailable');
  });

  it('survives the RPC throwing', async () => {
    const rpc = { multicall: vi.fn().mockRejectedValue(new Error('rpc down')) };
    const { flags } = await readStockReference(rpc as any, TSLAC, 100, NOW);
    expect(flags).toContain('reference_price_unavailable');
  });

  it('returns the reference but no premium when Fathom measured no price', async () => {
    const { reference, flags } = await readStockReference(feed(357.88) as any, TSLAC, null, NOW);

    expect(reference.reference_price_usd).toBeCloseTo(357.88, 2);
    expect(reference.premium_discount_bps).toBeNull();
    expect(flags).toContain('premium_unverified');
  });
});
