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
      num_pools: 2,
      is_stale: false,
      is_unsellable: false,
    };
    const result = calculateConfidence(input);
    expect(result.confidence).toBeGreaterThanOrEqual(80);
    expect(result.label).toBe('reliable');
  });
});
