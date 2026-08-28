/**
 * Executable depth.
 *
 * `liquidity_usd` answers "how much is parked here", which is not the question
 * an agent about to trade is asking. These helpers answer "if I sell $N of this
 * token right now, what do I actually receive" - which is what decides whether a
 * position can be exited at all.
 *
 * Everything here is closed-form and exact for constant-product pools
 * (Uniswap V2, Aerodrome volatile), computed from reserves already fetched, so
 * it costs no extra RPC. Pools with other curves - Uniswap V3 concentrated
 * liquidity, Aerodrome stable - are NOT approximated here; they need a real
 * quoter, and returning a plausible-looking number instead would repeat the
 * mistake this project has been removing.
 */

/** Notional sizes quoted for every token, in USD. */
export const SELL_QUOTE_SIZES_USD = [1000, 5000, 10000] as const;

export type SellQuote = {
  size_usd: number;
  /** USD actually received for that sale, or null when it cannot be computed. */
  proceeds_usd: number | null;
  /** Realised price per token across the whole fill. */
  execution_price_usd: number | null;
  /** Shortfall of the realised price against spot, in basis points. */
  price_impact_bps: number | null;
};

export type DepthResult = {
  sell_quotes: SellQuote[];
  /** Notional that moves the pool's marginal price by 1%. */
  depth_1pct_usd: number | null;
  /** Notional that moves the pool's marginal price by 5%. */
  depth_5pct_usd: number | null;
};

export type ConstantProductPool = {
  /** Reserve of the token being sold, in whole units. */
  reserveToken: number;
  /** Reserve of the quote token, in whole units. */
  reserveQuote: number;
  /** USD value of one unit of the quote token. */
  quoteUsdPrice: number;
  /** Swap fee as a fraction, e.g. 0.003 for 30 bps. */
  fee: number;
};

function isUsable(pool: ConstantProductPool): boolean {
  return (
    Number.isFinite(pool.reserveToken) && pool.reserveToken > 0 &&
    Number.isFinite(pool.reserveQuote) && pool.reserveQuote > 0 &&
    Number.isFinite(pool.quoteUsdPrice) && pool.quoteUsdPrice > 0 &&
    Number.isFinite(pool.fee) && pool.fee >= 0 && pool.fee < 1
  );
}

/**
 * Exact constant-product output: dy = y * dx' / (x + dx'), with dx' the input
 * net of fees. This is what a V2 router returns, so there is nothing to
 * approximate and nothing to fetch.
 */
export function constantProductSellQuote(pool: ConstantProductPool, sizeUsd: number): SellQuote {
  const empty: SellQuote = {
    size_usd: sizeUsd,
    proceeds_usd: null,
    execution_price_usd: null,
    price_impact_bps: null
  };

  if (!isUsable(pool) || !Number.isFinite(sizeUsd) || sizeUsd <= 0) return empty;

  const spotPriceUsd = (pool.reserveQuote / pool.reserveToken) * pool.quoteUsdPrice;
  if (!Number.isFinite(spotPriceUsd) || spotPriceUsd <= 0) return empty;

  const amountIn = sizeUsd / spotPriceUsd;         // token units to sell
  const amountInAfterFee = amountIn * (1 - pool.fee);
  const amountOut =
    (pool.reserveQuote * amountInAfterFee) / (pool.reserveToken + amountInAfterFee);

  const proceedsUsd = amountOut * pool.quoteUsdPrice;
  if (!Number.isFinite(proceedsUsd) || proceedsUsd <= 0) return empty;

  const executionPriceUsd = proceedsUsd / amountIn;

  return {
    size_usd: sizeUsd,
    proceeds_usd: proceedsUsd,
    execution_price_usd: executionPriceUsd,
    price_impact_bps: (1 - executionPriceUsd / spotPriceUsd) * 10000
  };
}

/**
 * Notional that moves the marginal price down by `drop` (0.01 = 1%).
 *
 * After selling dx', the marginal price is y*x / (x + dx')^2. Setting that to
 * (1 - drop) times spot gives dx' = x * (1/sqrt(1 - drop) - 1).
 */
export function constantProductDepth(pool: ConstantProductPool, drop: number): number | null {
  if (!isUsable(pool) || !(drop > 0) || !(drop < 1)) return null;

  const spotPriceUsd = (pool.reserveQuote / pool.reserveToken) * pool.quoteUsdPrice;
  if (!Number.isFinite(spotPriceUsd) || spotPriceUsd <= 0) return null;

  const amountInAfterFee = pool.reserveToken * (1 / Math.sqrt(1 - drop) - 1);
  const amountIn = amountInAfterFee / (1 - pool.fee);
  const notionalUsd = amountIn * spotPriceUsd;

  return Number.isFinite(notionalUsd) && notionalUsd > 0 ? notionalUsd : null;
}

export function constantProductDepthProfile(pool: ConstantProductPool): DepthResult {
  return {
    sell_quotes: SELL_QUOTE_SIZES_USD.map(size => constantProductSellQuote(pool, size)),
    depth_1pct_usd: constantProductDepth(pool, 0.01),
    depth_5pct_usd: constantProductDepth(pool, 0.05)
  };
}

/** Depth we could not compute: every field explicitly null, never a guess. */
export function unknownDepth(): DepthResult {
  return {
    sell_quotes: SELL_QUOTE_SIZES_USD.map(size => ({
      size_usd: size,
      proceeds_usd: null,
      execution_price_usd: null,
      price_impact_bps: null
    })),
    depth_1pct_usd: null,
    depth_5pct_usd: null
  };
}

/**
 * Build a depth profile from exact on-chain quotes.
 *
 * `proceedsUsd[i]` is what the DEX itself said size `SELL_QUOTE_SIZES_USD[i]`
 * returns, or null where that size could not be filled. Unlike the closed-form
 * path there is no cheap way to invert a router for "the notional that moves
 * price 1%", so those stay null rather than being interpolated.
 */
export function quotedDepthProfile(
  proceedsUsd: (number | null)[],
  spotPriceUsd: number
): DepthResult {
  return {
    sell_quotes: SELL_QUOTE_SIZES_USD.map((size, i) => {
      const proceeds = proceedsUsd[i];
      if (proceeds === null || proceeds === undefined || !Number.isFinite(proceeds) || proceeds <= 0) {
        return { size_usd: size, proceeds_usd: null, execution_price_usd: null, price_impact_bps: null };
      }
      if (!Number.isFinite(spotPriceUsd) || spotPriceUsd <= 0) {
        return { size_usd: size, proceeds_usd: proceeds, execution_price_usd: null, price_impact_bps: null };
      }

      const amountIn = size / spotPriceUsd;
      const executionPriceUsd = proceeds / amountIn;
      return {
        size_usd: size,
        proceeds_usd: proceeds,
        execution_price_usd: executionPriceUsd,
        price_impact_bps: (1 - executionPriceUsd / spotPriceUsd) * 10000
      };
    }),
    depth_1pct_usd: null,
    depth_5pct_usd: null
  };
}

/** True when a profile carries no usable information at all. */
export function isDepthUnknown(depth: DepthResult): boolean {
  return (
    depth.depth_1pct_usd === null &&
    depth.sell_quotes.every(q => q.proceeds_usd === null)
  );
}
