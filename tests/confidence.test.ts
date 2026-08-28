import { describe, it, expect } from 'vitest';
import { calculateConfidence, type ConfidenceInput } from '../src/confidence';

describe('Confidence Score Module', () => {
  it('Should calculate PEPECOIN example from README to ~74', () => {
    // PEPECOIN from README:
    // liq = $84,200
    // max_dev = 1.5% -> 0.015
    // spot vs twap = 0.45% -> 0.0045
    // sigma/mu = 2.7% -> 0.027
    // age = 12d, vol = $40k
    // multiple pools (not single pool) -> let's say 2
    // returns ~74 and thin / volatile
    const input: ConfidenceInput = {
      liquidity_usd: 84200,
      max_deviation_percent: 0.015,
      spot_vs_twap_percent: 0.0045,
      sigma_over_mu_percent: 0.027,
      pool_age_days: 12,
      volume_24h_usd: 40000,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 2,
      is_stale: false,
      is_unsellable: false,
    };

    const result = calculateConfidence(input);

    // Allowing +/- 1 variance due to roundings in the example vs raw floating point
    expect(result.confidence).toBeGreaterThanOrEqual(73);
    expect(result.confidence).toBeLessThanOrEqual(75);
    expect(result.label).toBe('thin / volatile');
    expect(result.flags.length).toBe(0);
  });

  it('Should set thin_liquidity flag and cap confidence to 49', () => {
    const input: ConfidenceInput = {
      liquidity_usd: 1500, // < 2000
      max_deviation_percent: 0.01,
      spot_vs_twap_percent: 0.01,
      sigma_over_mu_percent: 0.01,
      pool_age_days: 30,
      volume_24h_usd: 100000,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 2,
      is_stale: false,
      is_unsellable: false,
    };

    const result = calculateConfidence(input);

    expect(result.confidence).toBeLessThanOrEqual(49);
    expect(result.label).toBe('unreliable');
    expect(result.flags).toContain('thin_liquidity');
  });

  it('Should set possible_manipulation flag and cap confidence to 39', () => {
    const input: ConfidenceInput = {
      liquidity_usd: 500000,
      max_deviation_percent: 0.01,
      spot_vs_twap_percent: 0.30, // > 25%
      sigma_over_mu_percent: 0.01,
      pool_age_days: 30,
      volume_24h_usd: 500000,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 2,
      is_stale: false,
      is_unsellable: false,
    };

    const result = calculateConfidence(input);

    expect(result.confidence).toBeLessThanOrEqual(39);
    expect(result.label).toBe('unreliable');
    expect(result.flags).toContain('possible_manipulation');
  });

  it('Should set single_pool flag and cap confidence to 69', () => {
    const input: ConfidenceInput = {
      liquidity_usd: 500000,
      max_deviation_percent: 0.0,
      spot_vs_twap_percent: 0.01,
      sigma_over_mu_percent: 0.01,
      pool_age_days: 30,
      volume_24h_usd: 500000,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 1, // Only 1 pool
      is_stale: false,
      is_unsellable: false,
    };

    const result = calculateConfidence(input);

    expect(result.confidence).toBeLessThanOrEqual(69);
    expect(result.label).toBe('thin / volatile');
    expect(result.flags).toContain('single_pool');
  });

  it('Should set stale flag and cap confidence to 29', () => {
    const input: ConfidenceInput = {
      liquidity_usd: 500000,
      max_deviation_percent: 0.01,
      spot_vs_twap_percent: 0.01,
      sigma_over_mu_percent: 0.01,
      pool_age_days: 30,
      volume_24h_usd: 500000,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 2,
      is_stale: true, // Stale
      is_unsellable: false,
    };

    const result = calculateConfidence(input);

    expect(result.confidence).toBeLessThanOrEqual(29);
    expect(result.label).toBe('unreliable');
    expect(result.flags).toContain('stale');
  });

  it('Should set unsellable flag and drop confidence to 0', () => {
    const input: ConfidenceInput = {
      liquidity_usd: 500000,
      max_deviation_percent: 0.01,
      spot_vs_twap_percent: 0.01,
      sigma_over_mu_percent: 0.01,
      pool_age_days: 30,
      volume_24h_usd: 500000,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 2,
      is_stale: false,
      is_unsellable: true, // Unsellable
    };

    const result = calculateConfidence(input);

    expect(result.confidence).toBe(0);
    expect(result.label).toBe('unreliable');
    expect(result.flags).toContain('unsellable');
  });

  it('Should return a reliable score (80-100) for excellent metrics', () => {
    const input: ConfidenceInput = {
      liquidity_usd: 300000, // > L_good
      max_deviation_percent: 0.01, // 1%
      spot_vs_twap_percent: 0.01, // 1%
      sigma_over_mu_percent: 0.02, // 2%
      pool_age_days: 40, // > 30d
      volume_24h_usd: 600000, // > 500k
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 3,
      is_stale: false,
      is_unsellable: false,
    };

    const result = calculateConfidence(input);

    expect(result.confidence).toBeGreaterThanOrEqual(80);
    expect(result.label).toBe('reliable');
    expect(result.flags.length).toBe(0);
  });

  it('Should handle zero or negative liquidity_usd and volume_24h_usd', () => {
    const input: ConfidenceInput = {
      liquidity_usd: 0,
      max_deviation_percent: 0.01,
      spot_vs_twap_percent: 0.01,
      sigma_over_mu_percent: 0.01,
      pool_age_days: 30,
      volume_24h_usd: 0,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 2,
      is_stale: false,
      is_unsellable: false,
    };
    const result = calculateConfidence(input);
    expect(result.confidence).toBeLessThanOrEqual(49);
    expect(result.flags).toContain('thin_liquidity');
  });

  it('Should clamp max deviation, twap, and sigma metrics to zero score when exceeding max thresholds', () => {
    const input: ConfidenceInput = {
      liquidity_usd: 500000,
      max_deviation_percent: 1.0,
      spot_vs_twap_percent: 1.0,
      sigma_over_mu_percent: 1.0,
      pool_age_days: 0,
      volume_24h_usd: 500000,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 2,
      is_stale: false,
      is_unsellable: false,
    };
    const result = calculateConfidence(input);
    expect(result.confidence).toBeLessThanOrEqual(39);
    expect(result.flags).toContain('possible_manipulation');
  });

  it('Should handle multiple flags concurrently and apply lowest cap', () => {
    const input: ConfidenceInput = {
      liquidity_usd: 1500,
      max_deviation_percent: 0.01,
      spot_vs_twap_percent: 0.30,
      sigma_over_mu_percent: 0.01,
      pool_age_days: 30,
      volume_24h_usd: 500000,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 1,
      is_stale: true,
      is_unsellable: false,
    };
    const result = calculateConfidence(input);
    expect(result.confidence).toBeLessThanOrEqual(29);
    expect(result.flags).toContain('thin_liquidity');
    expect(result.flags).toContain('possible_manipulation');
    expect(result.flags).toContain('single_pool');
    expect(result.flags).toContain('stale');
  });

  it('Should handle negative percentage metrics correctly', () => {
    const input: ConfidenceInput = {
      liquidity_usd: 500000,
      max_deviation_percent: -0.05,
      spot_vs_twap_percent: -0.05,
      sigma_over_mu_percent: -0.05,
      pool_age_days: 30,
      volume_24h_usd: 500000,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 2,
      is_stale: false,
      is_unsellable: false,
    };
    const result = calculateConfidence(input);
    expect(result.confidence).toBeGreaterThanOrEqual(80);
    expect(result.label).toBe('reliable');
  });
  it('excludes unmeasured components instead of scoring them as healthy', () => {
    const base = {
      liquidity_usd: 300000,
      max_deviation_percent: 0.0,
      sigma_over_mu_percent: 0.0,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 3,
      is_stale: null,
      is_unsellable: null,
    };

    const result = calculateConfidence({
      ...base,
      spot_vs_twap_percent: null,
      pool_age_days: null,
      volume_24h_usd: null,
    } as ConfidenceInput);

    // liquidity .15 + source_agreement .20 + volatility .15 = .50 of the model
    // (execution_quality, twap_deviation and maturity are all unmeasured here)
    expect(result.measured_weight).toBeCloseTo(0.5, 8);
    expect(result.components.twap_deviation.score).toBeNull();
    expect(result.components.twap_deviation.effective_weight).toBe(0);
    expect(result.components.maturity.score).toBeNull();
    // the measured components share the full weight between them
    expect(result.components.liquidity.effective_weight).toBeCloseTo(0.15 / 0.5, 8);
    expect(result.components.source_agreement.effective_weight).toBeCloseTo(0.2 / 0.5, 8);
    expect(result.components.volatility.effective_weight).toBeCloseTo(0.15 / 0.5, 8);
    expect(result.components.execution_quality.score).toBeNull();
  });

  it('names the checks that did not run', () => {
    const result = calculateConfidence({
      liquidity_usd: 300000,
      max_deviation_percent: 0.0,
      spot_vs_twap_percent: null,
      sigma_over_mu_percent: 0.0,
      pool_age_days: null,
      volume_24h_usd: null,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 3,
      is_stale: null,
      is_unsellable: null,
    });

    expect(result.flags).toContain('twap_unavailable');
    expect(result.flags).toContain('freshness_unchecked');
    expect(result.flags).toContain('sellability_unchecked');
  });

  it('can reach the top band on measured signals alone, but still flags the missing check', () => {
    // Perfect on every measurable axis. The unavailable manipulation check no
    // longer caps the score; it is reported through flags instead.
    const result = calculateConfidence({
      liquidity_usd: 10_000_000,
      max_deviation_percent: 0.0,
      spot_vs_twap_percent: null,
      sigma_over_mu_percent: 0.0,
      pool_age_days: null,
      volume_24h_usd: null,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 5,
      is_stale: null,
      is_unsellable: null,
    });

    expect(result.confidence).toBe(100);
    expect(result.label).toBe('reliable');
    expect(result.flags).toContain('twap_unavailable');
    expect(result.components.twap_deviation.score).toBeNull();
    expect(result.measured_weight).toBeCloseTo(0.5, 8);
  });

  it('scores 0 when nothing at all could be measured', () => {
    const result = calculateConfidence({
      liquidity_usd: 0,
      max_deviation_percent: null,
      spot_vs_twap_percent: null,
      sigma_over_mu_percent: null,
      pool_age_days: null,
      volume_24h_usd: null,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 0,
      is_stale: null,
      is_unsellable: null,
    });

    // liquidity is measured (and zero); everything else is unknown
    expect(result.measured_weight).toBeCloseTo(0.15, 8);
    expect(result.confidence).toBe(0);
    expect(result.label).toBe('unreliable');
  });

  it('still measures maturity when only one of age or volume is known', () => {
    const withAgeOnly = calculateConfidence({
      liquidity_usd: 300000,
      max_deviation_percent: 0.0,
      spot_vs_twap_percent: 0.0,
      sigma_over_mu_percent: 0.0,
      pool_age_days: 30,
      volume_24h_usd: null,
      execution_impact_bps: null,
      execution_fillable: null,
      num_pools: 3,
      is_stale: false,
      is_unsellable: false,
    });

    expect(withAgeOnly.components.maturity.score).toBe(1);
    // everything but execution_quality, which has no depth data in this input
    expect(withAgeOnly.measured_weight).toBeCloseTo(0.8, 8);
  });
  it('scores execution quality from the headline sale impact', () => {
    const base = {
      liquidity_usd: 300000,
      max_deviation_percent: 0.0,
      spot_vs_twap_percent: 0.0,
      sigma_over_mu_percent: 0.0,
      pool_age_days: 30,
      volume_24h_usd: 500000,
      num_pools: 3,
      is_stale: false,
      is_unsellable: false,
    };

    // 0 bps impact = perfect execution
    const clean = calculateConfidence({ ...base, execution_impact_bps: 0, execution_fillable: true });
    expect(clean.components.execution_quality.score).toBe(1);

    // 500 bps of a 1000 bps ceiling = half marks
    const middling = calculateConfidence({ ...base, execution_impact_bps: 500, execution_fillable: true });
    expect(middling.components.execution_quality.score).toBeCloseTo(0.5, 8);

    // beyond the ceiling, zero - but the price is still measured
    const brutal = calculateConfidence({ ...base, execution_impact_bps: 2500, execution_fillable: true });
    expect(brutal.components.execution_quality.score).toBe(0);

    expect(clean.confidence).toBeGreaterThan(middling.confidence);
    expect(middling.confidence).toBeGreaterThan(brutal.confidence);
  });

  it('treats an unfillable headline sale as a measured zero, not a gap', () => {
    const result = calculateConfidence({
      liquidity_usd: 300000,
      max_deviation_percent: 0.0,
      spot_vs_twap_percent: 0.0,
      sigma_over_mu_percent: 0.0,
      pool_age_days: 30,
      volume_24h_usd: 500000,
      num_pools: 3,
      is_stale: false,
      is_unsellable: false,
      execution_impact_bps: null,
      execution_fillable: false,
    });

    // measured, so it counts against the score rather than being redistributed
    expect(result.components.execution_quality.score).toBe(0);
    expect(result.components.execution_quality.effective_weight).toBeGreaterThan(0);
    expect(result.measured_weight).toBeCloseTo(1.0, 8);

    expect(result.flags).toContain('no_exit_liquidity');
    expect(result.confidence).toBeLessThanOrEqual(39);
    expect(result.label).toBe('unreliable');
  });

  it('excludes liquidity entirely when the pool reports no real balance', () => {
    const result = calculateConfidence({
      liquidity_usd: null,
      max_deviation_percent: 0.0,
      spot_vs_twap_percent: 0.0,
      sigma_over_mu_percent: 0.0,
      pool_age_days: 30,
      volume_24h_usd: 500000,
      num_pools: 3,
      is_stale: false,
      is_unsellable: false,
      execution_impact_bps: 100,
      execution_fillable: true,
    });

    expect(result.components.liquidity.score).toBeNull();
    expect(result.components.liquidity.effective_weight).toBe(0);
    expect(result.flags).toContain('liquidity_unmeasured');
    // the thin_liquidity ceiling cannot fire on a number we do not have
    expect(result.flags).not.toContain('thin_liquidity');
    expect(result.measured_weight).toBeCloseTo(0.85, 8);
  });

  it('keeps the thin_liquidity ceiling when liquidity IS measured and low', () => {
    const result = calculateConfidence({
      liquidity_usd: 1500,
      max_deviation_percent: 0.0,
      spot_vs_twap_percent: 0.0,
      sigma_over_mu_percent: 0.0,
      pool_age_days: 30,
      volume_24h_usd: 500000,
      num_pools: 3,
      is_stale: false,
      is_unsellable: false,
      execution_impact_bps: 0,
      execution_fillable: true,
    });

    expect(result.flags).toContain('thin_liquidity');
    expect(result.confidence).toBeLessThanOrEqual(49);
  });
});
