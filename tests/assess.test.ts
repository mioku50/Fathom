import { describe, it, expect } from 'vitest';
import { assess } from '../src/assess';
import type { PriceResponse } from '../src/schema';

/**
 * The verdict is what an agent branches on, so the distinctions that matter
 * most are the ones between "bad" and "unknown".
 */

const BASE: PriceResponse = {
  token: '0x1111111111111111111111111111111111111111',
  chain: 'base',
  symbol: 'TKN',
  price_usd: 1,
  confidence: 96,
  label: 'reliable',
  liquidity_usd: null,
  source_count: 6,
  price_dispersion_bps: 40,
  measured_weight: 0.75,
  confidence_components: {} as any,
  twap: { price_usd: 1, window_seconds: 300, spot_deviation_bps: 0.9 },
  sell_quotes: [
    { size_usd: 10000, proceeds_usd: 9952, execution_price_usd: 0.9952, price_impact_bps: 48 }
  ],
  depth_1pct_usd: null,
  depth_5pct_usd: null,
  main_pool: { dex: 'aerodrome_slipstream', address: '0xpool', price_usd: 1 },
  flags: [],
  updated_at: '2026-08-29T10:00:00.000Z'
};

const withQuote = (over: Partial<PriceResponse['sell_quotes'][number]>, rest: Partial<PriceResponse> = {}) => ({
  ...BASE,
  ...rest,
  sell_quotes: [{ ...BASE.sell_quotes[0], ...over }]
});

describe('verdict', () => {
  it('clears a cheap exit against a corroborated price', () => {
    const a = assess(BASE, 10000);
    expect(a.verdict).toBe('tradeable');
    expect(a.reason).toContain('48 bps');
    expect(a.exit.fillable).toBe(true);
  });

  it('flags an exit that fills but costs real money', () => {
    // DEGEN's actual figure on Base.
    const a = assess(withQuote({ price_impact_bps: 231 }), 10000);
    expect(a.verdict).toBe('caution');
    expect(a.reason).toContain('231 bps');
  });

  it('refuses an exit that costs more than a tenth of the position', () => {
    const a = assess(withQuote({ price_impact_bps: 1200 }), 10000);
    expect(a.verdict).toBe('illiquid');
  });

  it('calls an unfillable size illiquid only when something else did fill', () => {
    // The quoter answered for $1k and not for $10k: that is a measurement.
    const priced = {
      ...BASE,
      sell_quotes: [
        { size_usd: 1000, proceeds_usd: 990, execution_price_usd: 0.99, price_impact_bps: 100 },
        { size_usd: 10000, proceeds_usd: null, execution_price_usd: null, price_impact_bps: null }
      ]
    };
    const a = assess(priced, 10000);
    expect(a.verdict).toBe('illiquid');
    expect(a.exit.fillable).toBe(false);
  });

  it('says unverified, not illiquid, when nothing was quoted at all', () => {
    // The distinction the whole service turns on: we did not establish that
    // there is no way out, we failed to look.
    const a = assess(
      withQuote({ proceeds_usd: null, execution_price_usd: null, price_impact_bps: null }),
      10000
    );
    expect(a.verdict).toBe('unverified');
    expect(a.exit.fillable).toBeNull();
    expect(a.reason).toMatch(/could not be measured/i);
  });

  it('withholds any verdict when most of the market went unread', () => {
    const a = assess(
      withQuote({ price_impact_bps: 9000 }, { flags: ['incomplete_pool_coverage'] }),
      10000
    );
    // A ruinous quote from one pool of twenty is not a finding about the token.
    expect(a.verdict).toBe('unverified');
    expect(a.reason).toMatch(/retry/i);
  });

  it('will not clear a cheap exit on a weakly corroborated price', () => {
    const a = assess({ ...BASE, measured_weight: 0.35, flags: ['low_measurement_coverage'] }, 10000);
    expect(a.verdict).toBe('caution');
    expect(a.reason).toMatch(/half the confidence model/i);
  });

  it('will not clear a token only one venue prices', () => {
    const a = assess({ ...BASE, source_count: 1, flags: ['single_pool'] }, 10000);
    expect(a.verdict).toBe('caution');
    expect(a.reason).toMatch(/single venue/i);
  });
});

describe('concerns and unverified are kept apart', () => {
  it('puts measured facts in concerns', () => {
    const a = assess({ ...BASE, flags: ['thin_liquidity', 'possible_manipulation'] }, 10000);
    expect(a.concerns).toHaveLength(2);
    expect(a.unverified).toHaveLength(0);
  });

  it('puts failures to look in unverified, never in concerns', () => {
    const a = assess(
      { ...BASE, flags: ['sellability_unchecked', 'liquidity_unmeasured', 'twap_unavailable'] },
      10000
    );
    expect(a.concerns).toHaveLength(0);
    expect(a.unverified).toHaveLength(3);
  });

  it('separates them within a single response', () => {
    const a = assess(
      { ...BASE, flags: ['thin_liquidity', 'sellability_unchecked'] },
      10000
    );
    expect(a.concerns).toHaveLength(1);
    expect(a.unverified).toHaveLength(1);
    expect(a.concerns[0]).not.toBe(a.unverified[0]);
  });

  it('never invents text for a flag it does not know', () => {
    const a = assess({ ...BASE, flags: ['something_new_we_added_later'] }, 10000);
    expect(a.concerns).toEqual([]);
    expect(a.unverified).toEqual([]);
    // An unrecognised flag must not silently become a concern.
    expect(a.verdict).toBe('tradeable');
  });
});

describe('the size asked about', () => {
  it('reports the verdict against the size the caller named', () => {
    const a = assess(withQuote({ size_usd: 3200, price_impact_bps: 15 }), 3200);
    expect(a.size_usd).toBe(3200);
    expect(a.reason).toContain('$3,200');
    expect(a.verdict).toBe('tradeable');
  });

  it('falls back to the largest quote when the exact size is absent', () => {
    const priced = {
      ...BASE,
      sell_quotes: [
        { size_usd: 1000, proceeds_usd: 999, execution_price_usd: 0.999, price_impact_bps: 10 },
        { size_usd: 10000, proceeds_usd: 9800, execution_price_usd: 0.98, price_impact_bps: 200 }
      ]
    };
    const a = assess(priced, 10000);
    expect(a.exit.price_impact_bps).toBe(200);
  });

  it('carries the price trust through unchanged rather than recomputing it', () => {
    const a = assess(BASE, 10000);
    expect(a.price_trust).toEqual({
      confidence: 96,
      measured_weight: 0.75,
      sources: 6,
      dispersion_bps: 40,
      twap_deviation_bps: 0.9
    });
  });
});

describe('a venue that could not be searched', () => {
  it('withholds the verdict rather than judging the venues that answered', () => {
    const a = assess(
      withQuote({ price_impact_bps: 8966 }, { flags: ['incomplete_venue_coverage'] }),
      10000
    );
    // The liquidity that makes this token tradeable may sit on the DEX we could
    // not reach, so a ruinous quote from the ones we could is not a finding.
    expect(a.verdict).toBe('unverified');
    expect(a.reason).toMatch(/DEXes could not be searched/i);
  });

  it('files it as unverified, never as a concern', () => {
    const a = assess({ ...BASE, flags: ['incomplete_venue_coverage'] }, 10000);
    expect(a.concerns).toEqual([]);
    expect(a.unverified).toHaveLength(1);
  });
});

describe('pools that could not be converted to USD', () => {
  it('withholds the verdict rather than judging the pools that survived', () => {
    const a = assess(
      withQuote({ price_impact_bps: 8966 }, { flags: ['incomplete_quote_coverage'] }),
      10000
    );
    expect(a.verdict).toBe('unverified');
    expect(a.reason).toMatch(/could not be converted to USD/i);
  });
});
