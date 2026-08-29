/**
 * Cross-source price dispersion.
 *
 * Every pool the engine already loaded produces its own USD price. Comparing
 * them answers "do independent venues agree on this price?" at the cost of zero
 * additional RPC calls - the data is already in hand by the time we get here.
 */

export type PriceSample = {
  priceUsd: number;
  /**
   * How much size sits behind this pool's price, in USD, used only as a
   * relative weight and never published.
   *
   * For constant-product pools this is the real quote-side balance. For
   * concentrated liquidity it is `L * sqrtP`, the virtual quote reserve at
   * spot - the same figure `liquidity_usd` refuses to report, and rightly so,
   * because it is not a balance the pool holds. It is however a sound measure
   * of depth *at the current price*, and for a constant-product pool the real
   * balance and the virtual reserve are the same number. That makes the two
   * comparable for the one job asked of them here: deciding which pools are
   * substantial enough to vote, and how loudly. Calling it liquidity was the
   * error; using it as a depth weight is not.
   */
  depthWeightUsd: number;
};

export type DispersionResult = {
  /** Pools deep enough to count as an independent price source. */
  sourceCount: number;
  /** max |p_i - mu| / mu across sources, or null with fewer than 2 sources. */
  maxDeviation: number | null;
  /** Depth-weighted sigma / mu across sources, or null with fewer than 2. */
  sigmaOverMu: number | null;
  /** Depth-weighted mean price across sources. */
  weightedMeanUsd: number | null;
};

/**
 * A pool must clear both an absolute floor and a share of the deepest pool to
 * vote. Without this a dust pool holding a stale price would dominate the
 * dispersion signal and mark otherwise healthy long-tail tokens as manipulated.
 */
const MIN_SOURCE_DEPTH_USD = 500;
const MIN_SOURCE_DEPTH_SHARE = 0.01;

export function computeDispersion(samples: PriceSample[]): DispersionResult {
  const usable = samples.filter(
    s =>
      Number.isFinite(s.priceUsd) &&
      s.priceUsd > 0 &&
      Number.isFinite(s.depthWeightUsd) &&
      s.depthWeightUsd > 0
  );

  if (usable.length === 0) {
    return { sourceCount: 0, maxDeviation: null, sigmaOverMu: null, weightedMeanUsd: null };
  }

  const deepest = Math.max(...usable.map(s => s.depthWeightUsd));
  // Never let the floor exclude the deepest pool itself.
  const floor = Math.min(
    deepest,
    Math.max(MIN_SOURCE_DEPTH_USD, deepest * MIN_SOURCE_DEPTH_SHARE)
  );
  const sources = usable.filter(s => s.depthWeightUsd >= floor);

  const totalWeight = sources.reduce((sum, s) => sum + s.depthWeightUsd, 0);
  const mu = sources.reduce((sum, s) => sum + s.priceUsd * s.depthWeightUsd, 0) / totalWeight;

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
    sources.reduce((sum, s) => sum + s.depthWeightUsd * Math.pow(s.priceUsd - mu, 2), 0) /
    totalWeight;
  const sigmaOverMu = Math.sqrt(variance) / mu;

  return {
    sourceCount: sources.length,
    maxDeviation,
    sigmaOverMu,
    weightedMeanUsd: mu
  };
}
