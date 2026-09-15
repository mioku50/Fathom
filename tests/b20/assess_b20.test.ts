import { describe, it, expect } from 'vitest';
import { assess, unverifiedAssessment } from '../../src/assess';
import type { PriceResponse } from '../../src/schema';
import type { B20Context } from '../../src/b20';

/**
 * The B20 layer adds asset semantics on top of an exit quote it does not touch.
 * These tests are mostly about what must NOT change.
 */

const PRICED: PriceResponse = {
  token: '0xb2000000000000000000001e800a7f5189430cD0',
  chain: 'base',
  symbol: 'TSLAc',
  price_usd: 357.88,
  confidence: 96,
  label: 'reliable',
  liquidity_usd: null,
  source_count: 6,
  price_dispersion_bps: 40,
  measured_weight: 0.75,
  confidence_components: {} as any,
  twap: { price_usd: 357.9, window_seconds: 300, spot_deviation_bps: 0.9 },
  sell_quotes: [
    { size_usd: 10000, proceeds_usd: 9952, execution_price_usd: 355.6, price_impact_bps: 48 }
  ],
  depth_1pct_usd: null,
  depth_5pct_usd: null,
  main_pool: { dex: 'uniswap_v3', address: '0xpool', price_usd: 357.88 },
  flags: [],
  updated_at: '2026-09-15T14:44:11.000Z'
};

const STOCK: B20Context = {
  asset_type: 'b20_stock',
  b20: {
    underlying: 'TSLA',
    multiplier: 1,
    ui_multiplier: null,
    next_ui_multiplier: null,
    effective_at: null,
    corporate_action_pending: false,
    paused: false,
    policy_restricted: false
  },
  stock_reference: {
    reference_price_usd: 357.4,
    premium_discount_bps: 13.4,
    source: 'chainlink',
    feed: '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4',
    updated_at: '2026-09-15T14:44:11.000Z',
    age_seconds: 54
  },
  flags: ['b20_asset', 'b20_scheduled_update_unverified']
};

const ctx = (over: Partial<B20Context> = {}): B20Context => ({
  ...STOCK,
  ...over,
  b20: { ...STOCK.b20!, ...(over.b20 ?? {}) }
});

describe('backward compatibility', () => {
  it('leaves a plain ERC-20 assessment exactly as it was', () => {
    const before = assess(PRICED, 10000);
    const withNull = assess(PRICED, 10000, null);

    expect(withNull).toEqual(before);
    expect(before.asset_type).toBe('erc20');
    expect(before).not.toHaveProperty('b20');
    expect(before).not.toHaveProperty('stock_reference');
    expect(before).not.toHaveProperty('asset_flags');
  });

  it('does not change the verdict, reason or exit of an ordinary token', () => {
    const plain = assess(PRICED, 10000);
    expect(plain.verdict).toBe('tradeable');
    expect(plain.exit).toEqual({
      fillable: true,
      proceeds_usd: 9952,
      price_impact_bps: 48,
      execution_price_usd: 355.6
    });
  });
});

describe('a verified tokenized stock', () => {
  it('carries the asset and reference blocks without disturbing the exit', () => {
    const a = assess(PRICED, 10000, ctx());

    expect(a.asset_type).toBe('b20_stock');
    expect(a.b20?.underlying).toBe('TSLA');
    expect(a.b20?.multiplier).toBe(1);
    expect(a.stock_reference?.reference_price_usd).toBe(357.4);
    expect(a.stock_reference?.premium_discount_bps).toBeCloseTo(13.4, 1);
    expect(a.asset_flags).toContain('b20_asset');

    // The exit quote is untouched and remains what execution is judged on.
    expect(a.exit.proceeds_usd).toBe(9952);
    expect(a.verdict).toBe('tradeable');
  });

  it('does not let a premium move the verdict', () => {
    // A premium is an observation about price. Whether the position can be
    // exited is the quote's question, and the quote has not changed.
    const rich = assess(PRICED, 10000, ctx({ flags: ['b20_asset', 'stock_premium_high'] }));
    const cheap = assess(PRICED, 10000, ctx({ flags: ['b20_asset', 'stock_discount_high'] }));

    expect(rich.verdict).toBe('tradeable');
    expect(cheap.verdict).toBe('tradeable');
  });

  it('does not let a missing reference feed become a negative verdict', () => {
    const a = assess(
      PRICED,
      10000,
      ctx({ stock_reference: null, flags: ['b20_asset', 'reference_price_unavailable'] })
    );

    expect(a.verdict).toBe('tradeable');
    expect(a.concerns).toEqual([]);
    expect(a.unverified.join(' ')).toMatch(/not a finding about the token/i);
  });

  it('records a frozen feed as unverified, never as a concern', () => {
    const a = assess(PRICED, 10000, ctx({ flags: ['b20_asset', 'reference_price_stale'] }));

    expect(a.verdict).toBe('tradeable');
    expect(a.concerns).toEqual([]);
    expect(a.unverified.join(' ')).toMatch(/holds its last value by design/i);
  });

  it('treats a configured policy as unverified, not as unsellable', () => {
    const a = assess(
      PRICED,
      10000,
      ctx({ b20: { ...STOCK.b20!, policy_restricted: true }, flags: ['b20_asset', 'b20_policy_unverified'] })
    );

    expect(a.verdict).toBe('tradeable');
    expect(a.concerns).toEqual([]);
    expect(a.unverified.join(' ')).toMatch(/does not know the selling address/i);
  });

  it('reports a corporate action as a concern but still lets the sale stand', () => {
    const a = assess(
      PRICED,
      10000,
      ctx({
        b20: { ...STOCK.b20!, corporate_action_pending: true },
        flags: ['b20_asset', 'corporate_action_pending']
      })
    );

    // Transfers keep working through a corporate action; only the feed freezes.
    expect(a.verdict).toBe('tradeable');
    expect(a.concerns.join(' ')).toMatch(/corporate action/i);
  });

  it('calls a paused transfer what it is, and not a scam or an empty pool', () => {
    const a = assess(
      PRICED,
      10000,
      ctx({ b20: { ...STOCK.b20!, paused: true }, flags: ['b20_asset', 'b20_transfer_paused'] })
    );

    expect(a.verdict).toBe('illiquid');
    expect(a.reason).toMatch(/issuer pause, not an absence of liquidity/i);
    expect(a.concerns.join(' ')).toMatch(/paused transfers/i);
  });

  it('says how many shares one token redeems for rather than assuming one', () => {
    const a = assess(PRICED, 10000, ctx({ b20: { ...STOCK.b20!, multiplier: 1.000377 } }));
    expect(a.b20?.multiplier).toBeCloseTo(1.000377, 6);
  });

  it('never silently defaults an unreadable multiplier', () => {
    const a = assess(
      PRICED,
      10000,
      ctx({ b20: { ...STOCK.b20!, multiplier: null }, flags: ['b20_asset', 'b20_metadata_unverified'] })
    );

    expect(a.b20?.multiplier).toBeNull();
    expect(a.unverified.join(' ')).toMatch(/how many shares one token redeems for is unknown/i);
  });
});

describe('an unpriced B20 token', () => {
  it('keeps the asset context on a 503 body', () => {
    const a = unverifiedAssessment(PRICED.token, 'base', 10000, ctx());

    expect(a.verdict).toBe('unverified');
    expect(a.asset_type).toBe('b20_stock');
    expect(a.b20?.underlying).toBe('TSLA');
    expect(a.stock_reference?.reference_price_usd).toBe(357.4);
    // Still not a finding about the token.
    expect(a.concerns).toEqual([]);
  });

  it('is unchanged for a plain ERC-20', () => {
    const a = unverifiedAssessment(PRICED.token, 'base', 10000);
    expect(a.asset_type).toBe('erc20');
    expect(a).not.toHaveProperty('b20');
    expect(a.unverified).toEqual([
      'No supported price source was measured.',
      'Pool discovery is not proof that no other pool exists.'
    ]);
  });
});
