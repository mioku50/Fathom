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
