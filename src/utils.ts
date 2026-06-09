import type { PriceResponse } from './schema';

export function generateDummyResponse(token: string, chain: string): PriceResponse {
  return {
    token,
    chain,
    symbol: "DUMMY",
    price_usd: 1.0,
    price_low: 0.95,
    price_high: 1.05,
    twap_5m: 1.01,
    confidence: 85,
    label: "reliable",
    liquidity_usd: 100000,
    main_pool: {
      dex: "aerodrome",
      address: "0x123",
      fee: 0.003
    },
    flags: [],
    updated_at: new Date().toISOString()
  };
}
