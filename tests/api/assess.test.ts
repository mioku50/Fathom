import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingError } from '../../src/errors';

const TOKEN = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';

const calculatePrice = vi.fn();

vi.mock('../../src/pricing_engine', () => ({
  PricingEngine: class {
    calculatePrice(...args: any[]) {
      return calculatePrice(...args);
    }
  },
  __clearAnchorMemo: () => {}
}));

vi.mock('../../src/orchestrator', () => ({
  DEXOrchestrator: vi.fn().mockImplementation(() => ({})),
  rawSetCacheKey: () => 'k'
}));

const { app } = await import('../../src/index');

const ENV = {
  ADMIN_AUTH_TOKEN: 'admin-secret',
  FATHOM_KV: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  },
  CACHE_DEFAULT_TTL_SECONDS: '60',
  BASE_RPC_URL: 'http://localhost:8545',
  X402_NETWORK: 'base',
  FATHOM_X402_RECIPIENT: '0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909',
  X402_PRICE_USDC: '0.001',
  FATHOM_X402_FACILITATOR_URL: 'http://facilitator',
  PRICE_RPC_URL: 'http://localhost:8545',
  PRICE_CHAIN_ID: '8453'
} as any;

const AUTH = { headers: { Authorization: 'Bearer admin-secret' } };

function priced(over: Record<string, any> = {}, quotes?: any[]) {
  return {
    token: TOKEN,
    chain: 'base',
    symbol: 'AERO',
    price_usd: 0.484,
    confidence: 96,
    label: 'reliable',
    liquidity_usd: null,
    source_count: 6,
    price_dispersion_bps: 40,
    measured_weight: 0.75,
    confidence_components: {},
    twap: { price_usd: 0.484, window_seconds: 300, spot_deviation_bps: 0.9 },
    sell_quotes: quotes ?? [
      { size_usd: 10000, proceeds_usd: 9952, execution_price_usd: 0.4818, price_impact_bps: 48 }
    ],
    depth_1pct_usd: null,
    depth_5pct_usd: null,
    main_pool: { dex: 'aerodrome_slipstream', address: '0xpool', price_usd: 0.484 },
    flags: [],
    updated_at: '2026-08-29T10:00:00.000Z',
    ...over
  };
}

const get = (qs: string) =>
  app.fetch(new Request(`https://fathom.test/v1/assess?${qs}`, AUTH), ENV, {
    waitUntil: () => {},
    passThroughOnException: () => {}
  } as any);

describe('GET /v1/assess', () => {
  beforeEach(() => {
    calculatePrice.mockReset();
    calculatePrice.mockResolvedValue(priced());
  });

  it('returns a verdict for the default size', async () => {
    const res = await get(`token=${TOKEN}`);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.verdict).toBe('tradeable');
    expect(body.size_usd).toBe(10000);
    expect(body.exit.price_impact_bps).toBe(48);
  });

  it('prices the size the caller named, on chain, rather than interpolating', async () => {
    calculatePrice.mockResolvedValue(
      priced({}, [{ size_usd: 3200, proceeds_usd: 3195, execution_price_usd: 0.4832, price_impact_bps: 16 }])
    );

    const res = await get(`token=${TOKEN}&size_usd=3200`);
    const body = await res.json() as any;

    // The engine is asked to quote exactly 3200, not the standard profile.
    expect(calculatePrice).toHaveBeenCalledWith(TOKEN, [3200]);
    expect(body.size_usd).toBe(3200);
  });

  it('rejects a size it cannot honestly quote', async () => {
    for (const bad of ['0', '-5', 'abc', '999999999999']) {
      const res = await get(`token=${TOKEN}&size_usd=${bad}`);
      expect(res.status, `size_usd=${bad}`).toBe(400);
      expect((await res.json() as any).error).toBe('invalid_request');
    }
  });

  it('rejects a chain it does not read, before charging for it', async () => {
    const res = await get(`token=${TOKEN}&chain=ethereum`);
    expect(res.status).toBe(400);
    expect(calculatePrice).not.toHaveBeenCalled();
  });

  it('rejects a malformed token address', async () => {
    const res = await get('token=not-an-address');
    expect(res.status).toBe(400);
  });

  it('reports a failed measurement as 503, never as a bad token', async () => {
    calculatePrice.mockRejectedValue(new PricingError('rpc_error', 'could not read pools'));

    const res = await get(`token=${TOKEN}`);
    expect(res.status).toBe(503);
    expect((await res.json() as any).error).toBe('rpc_error');
  });

  it('reports a token with no pools as 404', async () => {
    calculatePrice.mockResolvedValue(null);

    const res = await get(`token=${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('carries the two kinds of caveat through separately', async () => {
    calculatePrice.mockResolvedValue(
      priced({ flags: ['thin_liquidity', 'sellability_unchecked'] })
    );

    const body = await (await get(`token=${TOKEN}`)).json() as any;
    expect(body.concerns).toHaveLength(1);
    expect(body.unverified).toHaveLength(1);
  });
});
