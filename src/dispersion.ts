/**
 * Cross-source price dispersion.
 *
 * Every pool the engine already loaded produces its own USD price. Comparing
 * them answers "do independent venues agree on this price?" at the cost of zero
 * additional RPC calls - the data is already in hand by the time we get here.
 */

export type PriceSample = {
  priceUsd: number;
  liquidityUsd: number;
};

export type DispersionResult = {
  /** Pools deep enough to count as an independent price source. */
  sourceCount: number;
  /** max |p_i - mu| / mu across sources, or null with fewer than 2 sources. */
  maxDeviation: number | null;
  /** Liquidity-weighted sigma / mu across sources, or null with fewer than 2. */
  sigmaOverMu: number | null;
  /** Liquidity-weighted mean price across sources. */
  weightedMeanUsd: number | null;
};

/**
 * A pool must clear both an absolute floor and a share of the deepest pool to
 * vote. Without this a dust pool holding a stale price would dominate the
 * dispersion signal and mark otherwise healthy long-tail tokens as manipulated.
 */
const MIN_SOURCE_LIQUIDITY_USD = 500;
const MIN_SOURCE_LIQUIDITY_SHARE = 0.01;

export function computeDispersion(samples: PriceSample[]): DispersionResult {
  const usable = samples.filter(
    s =>
      Number.isFinite(s.priceUsd) &&
      s.priceUsd > 0 &&
      Number.isFinite(s.liquidityUsd) &&
      s.liquidityUsd > 0
  );

  if (usable.length === 0) {
    return { sourceCount: 0, maxDeviation: null, sigmaOverMu: null, weightedMeanUsd: null };
  }

  const deepest = Math.max(...usable.map(s => s.liquidityUsd));
  // Never let the floor exclude the deepest pool itself.
  const floor = Math.min(
    deepest,
    Math.max(MIN_SOURCE_LIQUIDITY_USD, deepest * MIN_SOURCE_LIQUIDITY_SHARE)
  );
  const sources = usable.filter(s => s.liquidityUsd >= floor);

  const totalWeight = sources.reduce((sum, s) => sum + s.liquidityUsd, 0);
  const mu = sources.reduce((sum, s) => sum + s.priceUsd * s.liquidityUsd, 0) / totalWeight;

  // A single source cannot disagree with itself; dispersion is undefined, not zero.
  if (sources.length < 2 || !Number.isFinite(mu) || mu <= 0) {
    return {
      sourceCount: sources.length,
      maxDeviation: null,
      sigmaOverMu: null,
      weightedMeanUsd: Number.isFinite(mu) && mu > 0 ? mu : null
    };
  }

  const maxDeviation = Math.max(...sources.map(s => Math.abs(s.priceUsd - mu))) / mu;

  const variance =
    sources.reduce((sum, s) => sum + s.liquidityUsd * Math.pow(s.priceUsd - mu, 2), 0) /
    totalWeight;
  const sigmaOverMu = Math.sqrt(variance) / mu;

  return {
    sourceCount: sources.length,
    maxDeviation,
    sigmaOverMu,
    weightedMeanUsd: mu
  };
}
