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
  liquidity_usd: number;
  /** Max relative spread of independent pool prices, as a fraction (0.015 = 1.5%). */
  max_deviation_percent: number | null;
  /** |spot - twap| / twap, as a fraction. */
  spot_vs_twap_percent: number | null;
  /** Liquidity-weighted sigma / mu across pools, as a fraction. */
  sigma_over_mu_percent: number | null;
  pool_age_days: number | null;
  volume_24h_usd: number | null;
  /** Number of independent pools deep enough to count as a price source. */
  num_pools: number;
  /** null = freshness was not established. */
  is_stale: boolean | null;
  /** null = no sell simulation / honeypot check was performed. */
  is_unsellable: boolean | null;
};

export type ConfidenceComponentName =
  | "liquidity"
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

const WEIGHTS: Record<ConfidenceComponentName, number> = {
  liquidity: 0.35,
  source_agreement: 0.20,
  twap_deviation: 0.20,
  volatility: 0.15,
  maturity: 0.10,
};

/**
 * Without a TWAP comparison there is no manipulation check, so no price can
 * honestly earn the top band. Anything above this is reported as
 * "thin / volatile" until real TWAP data is wired in.
 */
const NO_TWAP_CEILING = 79;

export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  const flags: string[] = [];

  // S_liq = clamp( log10(liq / L_min) / log10(L_good / L_min), 0, 1 )
  let S_liq = 0;
  if (input.liquidity_usd > 0) {
    const liqRatio = input.liquidity_usd / L_MIN;
    const goodRatio = L_GOOD / L_MIN;
    if (liqRatio > 0) {
      S_liq = clamp(Math.log10(liqRatio) / Math.log10(goodRatio), 0, 1);
    }
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

  // Say plainly which safety checks did not run.
  if (input.spot_vs_twap_percent === null) flags.push("twap_unavailable");
  if (input.is_stale === null) flags.push("freshness_unchecked");
  if (input.is_unsellable === null) flags.push("sellability_unchecked");

  // Apply risk ceilings (flags)
  if (input.liquidity_usd < L_MIN) {
    flags.push("thin_liquidity");
    confidence = Math.min(confidence, 49);
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

  // No manipulation check => cannot be called reliable.
  if (input.spot_vs_twap_percent === null) {
    confidence = Math.min(confidence, NO_TWAP_CEILING);
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
