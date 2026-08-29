import type { ConfidenceComponents } from './confidence';
import type { SellQuote } from './depth';

export type PoolData = {
  dex: string;
  address: string;
  liquidity_usd?: number;
  price_usd?: number;
  fee?: number;
};

export type PriceResponse = {
  token: string;
  chain: string;
  symbol: string;
  price_usd: number;
  confidence: number;
  label: string;
  /**
   * Parked liquidity in the main pool. null for concentrated-liquidity pools,
   * where the on-chain figure is an active-range parameter rather than a
   * balance; use `sell_quotes` for those.
   */
  liquidity_usd: number | null;
  /** Pools deep enough to count as an independent price source. */
  source_count: number;
  /** Spread between independent sources, in basis points; null with <2 sources. */
  price_dispersion_bps: number | null;
  /** Per-component breakdown of the confidence score, incl. what was not measured. */
  confidence_components: ConfidenceComponents;
  /**
   * Share of the nominal confidence model actually backed by a measurement,
   * 0..1. The score itself is computed only over measured components, so this
   * says how much evidence stands behind it: 1.0 is the whole model, 0.35 is a
   * number derived from barely a third of it.
   */
  measured_weight: number;
  /**
   * Time-weighted average price from the main pool's own oracle, with the
   * window it actually averaged over. Null when the pool cannot answer -
   * commonly a fresh pool whose observation cardinality is still 1.
   */
  twap: {
    price_usd: number | null;
    window_seconds: number | null;
    spot_deviation_bps: number | null;
  };
  /** What selling $1k / $5k / $10k of this token actually returns on the main pool. */
  sell_quotes: SellQuote[];
  /** Notional that moves the main pool's marginal price 1%; null when not computable. */
  depth_1pct_usd: number | null;
  /** Notional that moves the main pool's marginal price 5%; null when not computable. */
  depth_5pct_usd: number | null;
  main_pool: PoolData;
  pools?: PoolData[];
  flags: string[];
  updated_at: string;
};

export function isPoolData(data: any): data is PoolData {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.dex !== 'string' || data.dex.trim() === '') return false;
  if (typeof data.address !== 'string' || data.address.trim() === '') return false;
  if (data.liquidity_usd !== undefined && (typeof data.liquidity_usd !== 'number' || data.liquidity_usd < 0 || !Number.isFinite(data.liquidity_usd))) return false;
  if (data.price_usd !== undefined && (typeof data.price_usd !== 'number' || data.price_usd < 0 || !Number.isFinite(data.price_usd))) return false;
  if (data.fee !== undefined && (typeof data.fee !== 'number' || data.fee < 0 || !Number.isFinite(data.fee))) return false;
  return true;
}

export function isPriceResponse(data: any): data is PriceResponse {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.token !== 'string') return false;
  if (typeof data.chain !== 'string') return false;
  if (typeof data.symbol !== 'string') return false;
  if (typeof data.price_usd !== 'number') return false;
  if (typeof data.confidence !== 'number') return false;
  if (typeof data.label !== 'string') return false;
  if (data.liquidity_usd !== null && typeof data.liquidity_usd !== 'number') return false;
  if (typeof data.source_count !== 'number') return false;
  if (data.price_dispersion_bps !== null && typeof data.price_dispersion_bps !== 'number') return false;
  if (!data.confidence_components || typeof data.confidence_components !== 'object') return false;
  // Older cached entries predate this field; rejecting them recomputes them.
  if (typeof data.measured_weight !== 'number') return false;
  if (!data.twap || typeof data.twap !== 'object') return false;
  if (!Array.isArray(data.sell_quotes)) return false;
  if (data.depth_1pct_usd !== null && typeof data.depth_1pct_usd !== 'number') return false;
  if (data.depth_5pct_usd !== null && typeof data.depth_5pct_usd !== 'number') return false;
  if (!isPoolData(data.main_pool)) return false;
  if (data.pools !== undefined) {
    if (!Array.isArray(data.pools)) return false;
    if (!data.pools.every(isPoolData)) return false;
  }
  if (!Array.isArray(data.flags) || !data.flags.every((f: any) => typeof f === 'string')) return false;
  if (typeof data.updated_at !== 'string') return false;
  return true;
}

export type BatchPriceResult = 
  | (PriceResponse & { status: "ok" })
  | { token: string; status: "not_found" | "no_liquidity" | "rpc_error" | "stale_anchor" | "unknown_decimals"; error: { code: string; message: string } }

export type BatchPriceResponse = {
  chain: string;
  count: number;
  priced: number;
  failed: number;
  results: BatchPriceResult[];
}
