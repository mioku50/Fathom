import { describe, it, expect } from 'vitest';
import { computeDispersion } from '../src/dispersion';

describe('computeDispersion', () => {
  it('reports dispersion as undefined for a single source rather than as zero agreement', () => {
    const res = computeDispersion([{ priceUsd: 100, liquidityUsd: 50000 }]);

    expect(res.sourceCount).toBe(1);
    expect(res.maxDeviation).toBeNull();
    expect(res.sigmaOverMu).toBeNull();
    expect(res.weightedMeanUsd).toBe(100);
  });

  it('measures spread and volatility across two equally deep sources', () => {
    const res = computeDispersion([
      { priceUsd: 100, liquidityUsd: 10000 },
      { priceUsd: 110, liquidityUsd: 10000 }
    ]);

    expect(res.sourceCount).toBe(2);
    expect(res.weightedMeanUsd).toBeCloseTo(105, 8);
    // 5 / 105
    expect(res.maxDeviation).toBeCloseTo(0.047619, 5);
    expect(res.sigmaOverMu).toBeCloseTo(0.047619, 5);
  });

  it('weights the mean by liquidity', () => {
    const res = computeDispersion([
      { priceUsd: 100, liquidityUsd: 90000 },
      { priceUsd: 200, liquidityUsd: 10000 }
    ]);

    // (100*90000 + 200*10000) / 100000
    expect(res.weightedMeanUsd).toBeCloseTo(110, 8);
  });

  it('excludes dust pools so one stale micro-pool cannot fake manipulation', () => {
    const res = computeDispersion([
      { priceUsd: 100, liquidityUsd: 100000 },
      { priceUsd: 500, liquidityUsd: 100 } // below both the abs floor and 1% of deepest
    ]);

    expect(res.sourceCount).toBe(1);
    expect(res.maxDeviation).toBeNull();
    expect(res.weightedMeanUsd).toBe(100);
  });

  it('keeps the deepest pool even when it is below the absolute floor', () => {
    const res = computeDispersion([{ priceUsd: 100, liquidityUsd: 50 }]);

    expect(res.sourceCount).toBe(1);
    expect(res.weightedMeanUsd).toBe(100);
  });

  it('ignores non-finite and non-positive samples', () => {
    const res = computeDispersion([
      { priceUsd: 100, liquidityUsd: 10000 },
      { priceUsd: NaN, liquidityUsd: 10000 },
      { priceUsd: 0, liquidityUsd: 10000 },
      { priceUsd: 100, liquidityUsd: 0 }
    ]);

    expect(res.sourceCount).toBe(1);
  });

  it('returns an empty result when nothing is usable', () => {
    const res = computeDispersion([]);

    expect(res.sourceCount).toBe(0);
    expect(res.maxDeviation).toBeNull();
    expect(res.weightedMeanUsd).toBeNull();
  });
});
