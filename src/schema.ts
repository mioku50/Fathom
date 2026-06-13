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
  price_low: number;
  price_high: number;
  twap_5m: number;
  confidence: number;
  label: string;
  liquidity_usd: number;
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
  if (typeof data.price_low !== 'number') return false;
  if (typeof data.price_high !== 'number') return false;
  if (typeof data.twap_5m !== 'number') return false;
  if (typeof data.confidence !== 'number') return false;
  if (typeof data.label !== 'string') return false;
  if (typeof data.liquidity_usd !== 'number') return false;
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
  | { token: string; status: "not_found" | "no_liquidity" | "rpc_error"; error: { code: string; message: string } }

export type BatchPriceResponse = {
  chain: string;
  count: number;
  priced: number;
  failed: number;
  results: BatchPriceResult[];
}
