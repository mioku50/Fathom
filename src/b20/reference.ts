/**
 * The stock reference price, and what Fathom's own measurement is worth against it.
 *
 * The reference never replaces the executable price. `sell_quotes` remains the
 * only number that says what a sale returns; this says whether the venue is
 * quoting the equity at a premium or a discount to where the equity itself is.
 */

import {
  CHAINLINK_AGGREGATOR_ABI,
  REFERENCE_FEED_DECIMALS,
  REFERENCE_HEARTBEAT_SECONDS,
  verifiedStockFor
} from './constants';
import type { StockReference } from './types';
import type { B20RpcClient } from './reader';

/**
 * Deviation from the reference at which the gap is worth an agent's attention.
 *
 * Not picked round. The funded Coinbase-stock pools on Base are Uniswap v3
 * 0.30% tiers, so a round trip against the reference costs 60 bps in fees
 * before gas, and anything under that is microstructure rather than a signal
 * anyone can act on. Measured live on 2026-09-15, the real gaps sat at +13.6
 * bps (AAPLc) and -10.8 bps (NVDAc) — an order of magnitude inside it. 100 bps
 * is comfortably above the arbitrage floor and matches the impact figure this
 * codebase already calibrated as the line between "trade it" and "look first".
 *
 * These flags are reported, and deliberately do not move the verdict: a premium
 * is an observation about price, while the verdict is about whether the
 * position can be exited, which the quote already answers.
 */
export const PREMIUM_NOTABLE_BPS = 100;

export const NO_REFERENCE: StockReference = {
  reference_price_usd: null,
  premium_discount_bps: null,
  source: null,
  feed: null,
  updated_at: null,
  age_seconds: null
};

/**
 * Reads the Chainlink feed for a verified Coinbase stock.
 *
 * The value is a **total return**: the underlying's price already scaled by the
 * token's multiplier, which is to say the price of one token. Multiplying it by
 * the multiplier again — the obvious thing to do with a field called
 * "reference price" — would double-count every corporate action the token has
 * ever applied.
 *
 * `measuredPriceUsd` is Fathom's own price for the token, produced by the DEX
 * engine across every venue it could read. It is deliberately not a spot read
 * of one pool: several of these tokens have pools that are initialised but hold
 * nothing, and their `slot0` still returns a price. Taken at face value those
 * pools put AAPLc at exactly $1000.00 against a real reference of $329.64, and
 * TSLAc at 3.4e40. A premium computed from one of them would be a fabricated
 * number wearing four significant figures.
 */
export async function readStockReference(
  rpc: B20RpcClient,
  token: string,
  measuredPriceUsd: number | null,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<{ reference: StockReference; flags: string[] }> {
  const stock = verifiedStockFor(token);
  if (!stock) return { reference: NO_REFERENCE, flags: [] };

  let results: any[] = [];
  try {
    results = await rpc.multicall({
      allowFailure: true,
      contracts: [
        {
          address: stock.feed as `0x${string}`,
          abi: CHAINLINK_AGGREGATOR_ABI,
          functionName: 'latestRoundData'
        }
      ]
    });
  } catch {
    return { reference: { ...NO_REFERENCE, feed: stock.feed }, flags: ['reference_price_unavailable'] };
  }

  const round = results[0]?.status === 'success' ? results[0].result : null;
  if (!round || !Array.isArray(round) || round.length < 4) {
    return { reference: { ...NO_REFERENCE, feed: stock.feed }, flags: ['reference_price_unavailable'] };
  }

  const answer = round[1] as bigint;
  const updatedAt = round[3] as bigint;

  // A non-positive answer is not a price. Chainlink's int256 can carry one.
  if (typeof answer !== 'bigint' || answer <= 0n) {
    return { reference: { ...NO_REFERENCE, feed: stock.feed }, flags: ['reference_price_unavailable'] };
  }

  const referencePrice = Number(answer) / 10 ** REFERENCE_FEED_DECIMALS;
  const ageSeconds = Number(updatedAt) > 0 ? nowSeconds - Number(updatedAt) : null;

  const flags: string[] = [];

  // The feed holds its last value overnight, at weekends, on market holidays,
  // and while a corporate action is being applied. Age past the heartbeat means
  // the equity market is shut, not that anything is wrong, so it is recorded as
  // something we could not freshly establish and never as a fault of the token.
  if (ageSeconds !== null && ageSeconds > REFERENCE_HEARTBEAT_SECONDS) {
    flags.push('reference_price_stale');
  }

  let premiumBps: number | null = null;
  if (measuredPriceUsd !== null && Number.isFinite(measuredPriceUsd) && measuredPriceUsd > 0) {
    premiumBps = (measuredPriceUsd / referencePrice - 1) * 10_000;
    if (premiumBps >= PREMIUM_NOTABLE_BPS) flags.push('stock_premium_high');
    if (premiumBps <= -PREMIUM_NOTABLE_BPS) flags.push('stock_discount_high');
  } else {
    // A reference with nothing to compare it against is still worth returning;
    // the premium is not.
    flags.push('premium_unverified');
  }

  return {
    reference: {
      reference_price_usd: referencePrice,
      premium_discount_bps: premiumBps,
      source: 'chainlink',
      feed: stock.feed,
      updated_at: Number(updatedAt) > 0 ? new Date(Number(updatedAt) * 1000).toISOString() : null,
      age_seconds: ageSeconds
    },
    flags
  };
}
