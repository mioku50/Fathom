export type ConfidenceInput = {
  liquidity_usd: number;
  max_deviation_percent: number; // e.g., 0.015 for 1.5%
  spot_vs_twap_percent: number; // e.g., 0.0045 for 0.45%
  sigma_over_mu_percent: number; // e.g., 0.027 for 2.7%
  pool_age_days: number;
  volume_24h_usd: number;
  num_pools: number;
  is_stale: boolean;
  is_unsellable: boolean;
};

export type ConfidenceResult = {
  confidence: number;
  label: "reliable" | "thin / volatile" | "unreliable";
  flags: string[];
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
  const S_src = 1 - clamp(input.max_deviation_percent / D_MAX, 0, 1);

  // S_twap = 1 - clamp( abs(spot-twap)/twap / T_max, 0, 1 )
  const S_twap = 1 - clamp(input.spot_vs_twap_percent / T_MAX, 0, 1);

  // S_sigma = 1 - clamp( (sigma/mu) / Sg_max, 0, 1 )
  const S_sigma = 1 - clamp(input.sigma_over_mu_percent / SG_MAX, 0, 1);

  // S_mat = 0.5*age_f + 0.5*vol_f
  const age_f = clamp(input.pool_age_days / 30, 0, 1);
  let vol_f = 0;
  if (input.volume_24h_usd > 0) {
    const volRatio = input.volume_24h_usd / V_MIN;
    const goodVolRatio = V_MAX / V_MIN;
    if (volRatio > 0) {
      vol_f = clamp(Math.log10(volRatio) / Math.log10(goodVolRatio), 0, 1);
    }
  }
  const S_mat = 0.5 * age_f + 0.5 * vol_f;

  // Base confidence
  let confidence = Math.round(
    100 * (0.35 * S_liq + 0.20 * S_src + 0.20 * S_twap + 0.15 * S_sigma + 0.10 * S_mat)
  );

  // Apply risk ceilings (flags)
  if (input.liquidity_usd < L_MIN) {
    flags.push("thin_liquidity");
    confidence = Math.min(confidence, 49);
  }
  if (input.spot_vs_twap_percent > 0.25) {
    flags.push("possible_manipulation");
    confidence = Math.min(confidence, 39);
  }
  if (input.num_pools === 1) {
    flags.push("single_pool");
    confidence = Math.min(confidence, 69);
  }
  if (input.is_stale) {
    flags.push("stale");
    confidence = Math.min(confidence, 29);
  }
  if (input.is_unsellable) {
    flags.push("unsellable");
    confidence = 0;
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
  };
}
