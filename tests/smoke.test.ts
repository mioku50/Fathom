import { describe, it, expect, vi } from 'vitest';
import { runSmokeChecks } from '../src/smoke';
import { PricingError } from '../src/errors';

const WETH = '0x4200000000000000000000000000000000000006';
const AERO = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';

function healthyResponse(priceUsd: number) {
  return {
    price_usd: priceUsd,
    source_count: 4,
    sell_quotes: [
      { size_usd: 1000, proceeds_usd: 995, execution_price_usd: priceUsd, price_impact_bps: 50 },
      { size_usd: 5000, proceeds_usd: 4975, execution_price_usd: priceUsd, price_impact_bps: 50 },
      { size_usd: 10000, proceeds_usd: 9948, execution_price_usd: priceUsd, price_impact_bps: 52 }
    ],
    twap: { price_usd: priceUsd, window_seconds: 300, spot_deviation_bps: 1 }
  } as any;
}

function engineReturning(byToken: Record<string, any>) {
  const calculatePrice = vi.fn(async (token: string) => {
    const entry = byToken[token.toLowerCase()];
    if (entry instanceof Error) throw entry;
    return entry ?? null;
  });
  return () => ({ calculatePrice }) as any;
}

describe('runSmokeChecks', () => {
  it('passes when both probes look healthy', async () => {
    const result = await runSmokeChecks(engineReturning({
      [WETH.toLowerCase()]: healthyResponse(2438),
      [AERO.toLowerCase()]: healthyResponse(0.49)
    }));

    expect(result.ok).toBe(true);
    expect(result.checks.every(c => c.ok)).toBe(true);
    expect(typeof result.ran_at).toBe('string');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('catches a WETH price outside any plausible band', async () => {
    // The shape a decimals or anchor bug produces: a confident, wrong number.
    const result = await runSmokeChecks(engineReturning({
      [WETH.toLowerCase()]: healthyResponse(1.0),
      [AERO.toLowerCase()]: healthyResponse(0.49)
    }));

    expect(result.ok).toBe(false);
    expect(result.checks.find(c => c.name === 'weth_priced')?.ok).toBe(false);
  });

  it('catches coverage collapsing to a single source', async () => {
    const thin = { ...healthyResponse(2438), source_count: 1 };
    const result = await runSmokeChecks(engineReturning({
      [WETH.toLowerCase()]: thin,
      [AERO.toLowerCase()]: healthyResponse(0.49)
    }));

    expect(result.ok).toBe(false);
    expect(result.checks.find(c => c.name === 'weth_multi_source')?.ok).toBe(false);
  });

  it('catches quoters that have started reverting', async () => {
    const noDepth = {
      ...healthyResponse(2438),
      sell_quotes: healthyResponse(2438).sell_quotes.map((q: any) => ({ ...q, proceeds_usd: null }))
    };
    const result = await runSmokeChecks(engineReturning({
      [WETH.toLowerCase()]: noDepth,
      [AERO.toLowerCase()]: healthyResponse(0.49)
    }));

    expect(result.ok).toBe(false);
    expect(result.checks.find(c => c.name === 'weth_depth_quoted')?.ok).toBe(false);
  });

  it('catches a TWAP oracle that stopped answering', async () => {
    const noTwap = {
      ...healthyResponse(2438),
      twap: { price_usd: null, window_seconds: null, spot_deviation_bps: null }
    };
    const result = await runSmokeChecks(engineReturning({
      [WETH.toLowerCase()]: noTwap,
      [AERO.toLowerCase()]: healthyResponse(0.49)
    }));

    expect(result.ok).toBe(false);
    expect(result.checks.find(c => c.name === 'weth_twap')?.ok).toBe(false);
  });

  it('records a typed pricing failure by its code', async () => {
    const result = await runSmokeChecks(engineReturning({
      [WETH.toLowerCase()]: new PricingError('stale_anchor', 'anchor gone'),
      [AERO.toLowerCase()]: healthyResponse(0.49)
    }));

    expect(result.ok).toBe(false);
    expect(result.checks.find(c => c.name === 'weth_priced')?.detail).toBe('stale_anchor');
  });

  it('keeps probing after one token fails', async () => {
    const result = await runSmokeChecks(engineReturning({
      [WETH.toLowerCase()]: new Error('boom'),
      [AERO.toLowerCase()]: healthyResponse(0.49)
    }));

    expect(result.ok).toBe(false);
    // AERO was still checked rather than the run aborting on the first failure
    expect(result.checks.find(c => c.name === 'aero_priced')?.ok).toBe(true);
  });

  it('reports a token that returns no price at all', async () => {
    const result = await runSmokeChecks(engineReturning({
      [WETH.toLowerCase()]: healthyResponse(2438)
    }));

    expect(result.ok).toBe(false);
    expect(result.checks.find(c => c.name === 'aero_priced')?.detail).toBe('no price returned');
  });
});
