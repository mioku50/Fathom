/**
 * Confidence scoring.
 *
 * A component whose input is `null` was NOT measured. Such a component is
 * excluded from the score and its weight is redistributed across the components
 * we did measure, rather than being scored as if it were healthy. Scoring an
 * unmeasured signal as "fine" is what let a fabricated 0.01 TWAP deviation
 * contribute 20% of a high confidence number.
 *
 * `components` reports exactly which parts of the model were live for a given
 * response, so a caller can see what the number is actually based on.
 */

export type ConfidenceInput = {
  /**
   * Parked liquidity. null when the pool's figure is not a real TVL - notably
   * Uniswap V3, where `L * sqrtP` is an active-range parameter, not a balance.
   */
  liquidity_usd: number | null;
  /** Max relative spread of independent pool prices, as a fraction (0.015 = 1.5%). */
  max_deviation_percent: number | null;
  /** |spot - twap| / twap, as a fraction. */
  spot_vs_twap_percent: number | null;
  /** Liquidity-weighted sigma / mu across pools, as a fraction. */
  sigma_over_mu_percent: number | null;
  pool_age_days: number | null;
  volume_24h_usd: number | null;
  /** Price impact in bps on the largest advertised sale; null when unmeasured. */
  execution_impact_bps: number | null;
  /**
   * Whether that sale can be filled at all. false is a measurement (scores 0),
   * null means we never established it (excluded from the score).
   */
  execution_fillable: boolean | null;
  /** Number of independent pools deep enough to count as a price source. */
  num_pools: number;
  /** null = freshness was not established. */
  is_stale: boolean | null;
  /** null = no sell simulation / honeypot check was performed. */
  is_unsellable: boolean | null;
};

export type ConfidenceComponentName =
  | "liquidity"
  | "execution_quality"
  | "source_agreement"
  | "twap_deviation"
  | "volatility"
  | "maturity";

export type ConfidenceComponent = {
  /** 0..1, or null when the component could not be measured. */
  score: number | null;
  /** Nominal weight in the full model. */
  weight: number;
  /** Weight actually applied after redistribution; 0 for unmeasured components. */
  effective_weight: number;
};

export type ConfidenceComponents = Record<ConfidenceComponentName, ConfidenceComponent>;

export type ConfidenceResult = {
  confidence: number;
  label: "reliable" | "thin / volatile" | "unreliable";
  flags: string[];
  components: ConfidenceComponents;
  /** Share of the nominal model backed by real measurements, 0..1. */
  measured_weight: number;
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// Configurable constants based on README
const L_MIN = 2000;
const L_GOOD = 250000;
const D_MAX = 0.05; // 5%
const T_MAX = 0.10; // 10%
const SG_MAX = 0.08; // 8%
const V_MIN = 5000;
const V_MAX = 500000;
/** At or beyond this impact on the headline sale, execution quality scores 0. */
const IMPACT_MAX_BPS = 1000; // 10%

/**
 * Minimum share of the nominal model that must be measured before a response is
 * allowed to be labelled "reliable".
 */
const MIN_COVERAGE_FOR_RELIABLE = 0.5;

/**
 * The old model gave 0.35 to parked liquidity alone. That weight is now split:
 * what is parked still counts, but most of it moves to what an agent can
 * actually get out, which is the question the number was standing in for.
 */
const WEIGHTS: Record<ConfidenceComponentName, number> = {
  liquidity: 0.15,
  execution_quality: 0.20,
  source_agreement: 0.20,
  twap_deviation: 0.20,
  volatility: 0.15,
  maturity: 0.10,
};

export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  const flags: string[] = [];

  // S_liq = clamp( log10(liq / L_min) / log10(L_good / L_min), 0, 1 )
  let S_liq: number | null = null;
  if (input.liquidity_usd !== null) {
    S_liq = 0;
    if (input.liquidity_usd > 0) {
      const liqRatio = input.liquidity_usd / L_MIN;
      const goodRatio = L_GOOD / L_MIN;
      if (liqRatio > 0) {
        S_liq = clamp(Math.log10(liqRatio) / Math.log10(goodRatio), 0, 1);
      }
    }
  }

  // S_exec: what the headline sale actually costs.
  let S_exec: number | null = null;
  if (input.execution_fillable === false) {
    // Established that the sale cannot be filled. That is a bad score, not a gap.
    S_exec = 0;
  } else if (input.execution_fillable === true && input.execution_impact_bps !== null) {
    S_exec = 1 - clamp(input.execution_impact_bps / IMPACT_MAX_BPS, 0, 1);
  }

  // S_src = 1 - clamp( max_dev / D_max, 0, 1 )
  const S_src =
    input.max_deviation_percent === null
      ? null
      : 1 - clamp(input.max_deviation_percent / D_MAX, 0, 1);

  // S_twap = 1 - clamp( abs(spot-twap)/twap / T_max, 0, 1 )
  const S_twap =
    input.spot_vs_twap_percent === null
      ? null
      : 1 - clamp(input.spot_vs_twap_percent / T_MAX, 0, 1);

  // S_sigma = 1 - clamp( (sigma/mu) / Sg_max, 0, 1 )
  const S_sigma =
    input.sigma_over_mu_percent === null
      ? null
      : 1 - clamp(input.sigma_over_mu_percent / SG_MAX, 0, 1);

  // S_mat = 0.5*age_f + 0.5*vol_f, over whichever halves are available.
  const age_f = input.pool_age_days === null ? null : clamp(input.pool_age_days / 30, 0, 1);
  let vol_f: number | null = null;
  if (input.volume_24h_usd !== null) {
    vol_f = 0;
    if (input.volume_24h_usd > 0) {
      const volRatio = input.volume_24h_usd / V_MIN;
      const goodVolRatio = V_MAX / V_MIN;
      if (volRatio > 0) {
        vol_f = clamp(Math.log10(volRatio) / Math.log10(goodVolRatio), 0, 1);
      }
    }
  }
  let S_mat: number | null = null;
  if (age_f !== null && vol_f !== null) {
    S_mat = 0.5 * age_f + 0.5 * vol_f;
  } else if (age_f !== null) {
    S_mat = age_f;
  } else if (vol_f !== null) {
    S_mat = vol_f;
  }

  const scores: Record<ConfidenceComponentName, number | null> = {
    liquidity: S_liq,
    execution_quality: S_exec,
    source_agreement: S_src,
    twap_deviation: S_twap,
    volatility: S_sigma,
    maturity: S_mat,
  };

  // Redistribute the weight of unmeasured components across the measured ones.
  const names = Object.keys(WEIGHTS) as ConfidenceComponentName[];
  const measuredWeight = names.reduce(
    (sum, n) => (scores[n] === null ? sum : sum + WEIGHTS[n]),
    0
  );

  const components = {} as ConfidenceComponents;
  for (const n of names) {
    components[n] = {
      score: scores[n],
      weight: WEIGHTS[n],
      effective_weight:
        scores[n] === null || measuredWeight === 0 ? 0 : WEIGHTS[n] / measuredWeight,
    };
  }

  let confidence: number;
  if (measuredWeight === 0) {
    flags.push("no_measurable_signal");
    confidence = 0;
  } else {
    confidence = Math.round(
      100 *
        names.reduce(
          (sum, n) => (scores[n] === null ? sum : sum + scores[n]! * components[n].effective_weight),
          0
        )
    );
  }

  // Say plainly which safety checks did not run. These do not cap the score:
  // the score already reflects only what was measured, and `flags` is where a
  // caller learns that the manipulation check was not among it.
  if (input.spot_vs_twap_percent === null) flags.push("twap_unavailable");
  if (input.is_stale === null) flags.push("freshness_unchecked");
  if (input.is_unsellable === null) flags.push("sellability_unchecked");
  if (input.liquidity_usd === null) flags.push("liquidity_unmeasured");

  // Apply risk ceilings (flags)
  if (input.liquidity_usd !== null && input.liquidity_usd < L_MIN) {
    flags.push("thin_liquidity");
    confidence = Math.min(confidence, 49);
  }
  if (input.execution_fillable === false) {
    // No exit at the size we advertise is a hard risk, not a soft deduction.
    flags.push("no_exit_liquidity");
    confidence = Math.min(confidence, 39);
  }
  if (input.spot_vs_twap_percent !== null && input.spot_vs_twap_percent > 0.25) {
    flags.push("possible_manipulation");
    confidence = Math.min(confidence, 39);
  }
  if (input.num_pools === 1) {
    flags.push("single_pool");
    confidence = Math.min(confidence, 69);
  }
  if (input.is_stale === true) {
    flags.push("stale");
    confidence = Math.min(confidence, 29);
  }
  if (input.is_unsellable === true) {
    flags.push("unsellable");
    confidence = 0;
  }

  // A score is only as good as the share of the model behind it. With just
  // source_agreement and volatility live, a token can compute to 95 on 0.35 of
  // the nominal weight - a confident number about almost nothing. Redistribution
  // makes the arithmetic sound but cannot make the evidence sufficient, so below
  // half the model measured the answer may not call itself reliable.
  if (measuredWeight > 0 && measuredWeight < MIN_COVERAGE_FOR_RELIABLE) {
    flags.push("low_measurement_coverage");
    confidence = Math.min(confidence, 79);
  }

  // Determine label
  let label: "reliable" | "thin / volatile" | "unreliable";
  if (confidence >= 80) {
    label = "reliable";
  } else if (confidence >= 50) {
    label = "thin / volatile";
  } else {
    label = "unreliable";
  }

  return {
    confidence,
    label,
    flags,
    components,
    measured_weight: measuredWeight,
  };
}
