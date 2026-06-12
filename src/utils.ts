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


export function parseTokensParam(tokensParam: string): string[] {
  if (!tokensParam) return [];
  return tokensParam.split(',').map(t => t.trim()).filter(Boolean);
}

export function formatPriceResponse(
  token: string,
  chain: string,
  bestPrice: number,
  bestLiquidity: number,
  mainPoolData: any,
  confResult: { confidence: number; label: string; flags: string[] }
): PriceResponse {
  return {
    token,
    chain,
    symbol: 'TBD', // This could be fetched from metadata
    price_usd: bestPrice,
    price_low: bestPrice * 0.99,
    price_high: bestPrice * 1.01,
    twap_5m: bestPrice,
    confidence: confResult.confidence,
    label: confResult.label,
    liquidity_usd: bestLiquidity,
    main_pool: mainPoolData,
    flags: confResult.flags,
    updated_at: new Date().toISOString()
  };
}
