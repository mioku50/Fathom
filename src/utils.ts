import type { PriceResponse, PoolData } from './schema';

/**
 * Generates a dummy price response for a given token and chain.
 * Used as a placeholder when actual price data cannot be retrieved.
 *
 * @param token - The symbol or address of the token.
 * @param chain - The chain ID or name where the token resides.
 * @returns A mocked `PriceResponse` object.
 */
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


/**
 * Parses a comma-separated string of tokens into an array of trimmed strings.
 *
 * @param tokensParam - A comma-separated list of tokens.
 * @returns An array of token strings.
 */
export function parseTokensParam(tokensParam: string): string[] {
  if (!tokensParam) return [];
  return tokensParam.split(',').map(t => t.trim()).filter(Boolean);
}

/**
 * Formats data from various sources into a standardized `PriceResponse`.
 *
 * @param token - The token symbol or address.
 * @param chain - The blockchain network.
 * @param bestPrice - The resolved best price in USD.
 * @param bestLiquidity - The total or best liquidity in USD.
 * @param mainPoolData - Information about the primary pool used for pricing.
 * @param confResult - Confidence score and flags for the price.
 * @returns A structured `PriceResponse` object.
 */
export function formatPriceResponse(
  token: string,
  chain: string,
  bestPrice: number,
  bestLiquidity: number,
  mainPoolData: PoolData,
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
