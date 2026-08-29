/**
 * One verdict an agent can branch on.
 *
 * `/v1/price` returns everything measured and leaves the judgement to the
 * caller. That is the right default for a data endpoint, and the wrong shape
 * for an agent that has to decide something: reading it correctly means knowing
 * that 231 bps is a lot and 25 bps is not, that a confidence of 95 backed by a
 * third of the model means little, and that `exit_liquidity_unverified` is not
 * the same claim as `no_exit_liquidity`.
 *
 * This turns those readings into one word, at the size the caller actually
 * holds, and keeps the two kinds of caveat apart in the answer itself:
 * `concerns` is what is true about the token, `unverified` is what we could not
 * establish. Nothing here re-measures; it only decides.
 */

import type { PriceResponse } from './schema';

export type Verdict = 'tradeable' | 'caution' | 'illiquid' | 'unverified';

export type Assessment = {
  token: string;
  chain: string;
  symbol: string;
  price_usd: number;

  /** The single field to branch on. */
  verdict: Verdict;
  /** One sentence saying why, for logs and for humans reading an agent's trace. */
  reason: string;

  /** The sale this verdict is about. */
  size_usd: number;
  exit: {
    /** True if the sale fills, false if measured and it cannot, null if never established. */
    fillable: boolean | null;
    proceeds_usd: number | null;
    price_impact_bps: number | null;
    execution_price_usd: number | null;
  };

  price_trust: {
    confidence: number;
    /** Share of the confidence model actually measured, 0-1. */
    measured_weight: number;
    sources: number;
    dispersion_bps: number | null;
    twap_deviation_bps: number | null;
  };

  /** Measured facts about the token that argue against trading it. */
  concerns: string[];
  /** Checks that did not run. Never evidence against the token. */
  unverified: string[];

  updated_at: string;
};

/**
 * Impact thresholds, in basis points of the requested sale.
 *
 * Chosen against real Base tokens rather than picked round: cbBTC exits $10k at
 * 25 bps and AERO at 48, both of which an agent should simply trade. DEGEN
 * costs 231 bps, which is worth surfacing but is not a reason to refuse. Losing
 * a tenth of the position to slippage is.
 */
const IMPACT_TRADEABLE_BPS = 100;
const IMPACT_CAUTION_BPS = 1000;

/** Flags that describe the token, mapped to what they mean for a trade. */
const CONCERN_FLAGS: Record<string, string> = {
  thin_liquidity: 'Pool holds very little; the price moves easily.',
  no_exit_liquidity: 'The requested sale cannot be filled at any price.',
  possible_manipulation: 'Spot is far from the pool’s own time-weighted price.',
  single_pool: 'Only one venue prices this token; nothing corroborates it.',
  stale: 'The pool data is stale.',
  unsellable: 'A sale of this token reverts.'
};

/** Flags that describe our reading, not the token. */
const UNVERIFIED_FLAGS: Record<string, string> = {
  twap_unavailable: 'The pool has no usable price oracle, so spot could not be checked against a time-weighted price.',
  freshness_unchecked: 'Data staleness was not established.',
  sellability_unchecked: 'No honeypot or transfer-tax simulation was run.',
  depth_unavailable: 'Exit liquidity could not be measured on this pool.',
  liquidity_unmeasured: 'Concentrated liquidity has no balance to report; use the exit quote instead.',
  low_measurement_coverage: 'Under half the confidence model could be measured.',
  no_measurable_signal: 'None of the confidence model could be measured.',
  incomplete_pool_coverage: 'Most discovered pools could not be read, so this is not a reading of the whole market.',
  incomplete_venue_coverage: 'One or more DEXes could not be searched, so pools this token trades on may be missing entirely.',
  incomplete_quote_coverage: 'Pools quoted in another asset could not be converted to USD, so the deepest venue may be missing from this answer.',
  exit_liquidity_unverified: 'Whether the position can be exited was not established.',
  hardcoded_numeraire: 'This is USDC, whose value is defined rather than measured.'
};

/** Coverage below which no verdict about the market is offered. */
const MIN_COVERAGE_FOR_VERDICT = 0.5;

export function assess(price: PriceResponse, sizeUsd: number): Assessment {
  const quote =
    price.sell_quotes.find(q => q.size_usd === sizeUsd) ??
    price.sell_quotes.reduce<(typeof price.sell_quotes)[number] | null>(
      (largest, q) => (largest === null || q.size_usd > largest.size_usd ? q : largest),
      null
    );

  const impactBps = quote?.price_impact_bps ?? null;
  const proceeds = quote?.proceeds_usd ?? null;

  // Three states, not two. A sale that was never quoted is not a sale that
  // failed, and collapsing them is how an unread market becomes a verdict.
  const anyFilled = price.sell_quotes.some(q => q.proceeds_usd !== null);
  const fillable = impactBps !== null ? true : anyFilled ? false : null;

  const concerns = price.flags.filter(f => f in CONCERN_FLAGS).map(f => CONCERN_FLAGS[f]);
  const unverified = price.flags.filter(f => f in UNVERIFIED_FLAGS).map(f => UNVERIFIED_FLAGS[f]);

  const { verdict, reason } = decide({
    impactBps,
    fillable,
    sizeUsd,
    measuredWeight: price.measured_weight,
    flags: price.flags
  });

  return {
    token: price.token,
    chain: price.chain,
    symbol: price.symbol,
    price_usd: price.price_usd,
    verdict,
    reason,
    size_usd: sizeUsd,
    exit: {
      fillable,
      proceeds_usd: proceeds,
      price_impact_bps: impactBps,
      execution_price_usd: quote?.execution_price_usd ?? null
    },
    price_trust: {
      confidence: price.confidence,
      measured_weight: price.measured_weight,
      sources: price.source_count,
      dispersion_bps: price.price_dispersion_bps,
      twap_deviation_bps: price.twap.spot_deviation_bps
    },
    concerns,
    unverified,
    updated_at: price.updated_at
  };
}

function decide(input: {
  impactBps: number | null;
  fillable: boolean | null;
  sizeUsd: number;
  measuredWeight: number;
  flags: string[];
}): { verdict: Verdict; reason: string } {
  const usd = `$${input.sizeUsd.toLocaleString('en-US')}`;

  // A measurement taken on a fraction of the market is not a measurement of the
  // market, so it does not get to condemn or clear the token.
  if (input.flags.includes('incomplete_pool_coverage')) {
    return {
      verdict: 'unverified',
      reason: 'Most of this token’s pools could not be read, so neither its price nor its exit was established. Retry before acting.'
    };
  }

  // A venue we could not search may hold the liquidity that makes this token
  // tradeable. Quoting the venues that did answer would describe a market the
  // token does not have.
  if (input.flags.includes('incomplete_venue_coverage')) {
    return {
      verdict: 'unverified',
      reason: 'One or more DEXes could not be searched, so this may be missing the pools the token actually trades in. Retry before acting.'
    };
  }

  if (input.flags.includes('incomplete_quote_coverage')) {
    return {
      verdict: 'unverified',
      reason: 'Pools quoted in another asset could not be converted to USD, so the deepest venue may be missing from this answer. Retry before acting.'
    };
  }

  if (input.fillable === null) {
    return {
      verdict: 'unverified',
      reason: `Exit liquidity for ${usd} could not be measured on this token’s pools.`
    };
  }

  if (input.fillable === false) {
    return {
      verdict: 'illiquid',
      reason: `${usd} cannot be sold: the pools quote no fill at that size.`
    };
  }

  const impact = input.impactBps!;

  if (impact >= IMPACT_CAUTION_BPS) {
    return {
      verdict: 'illiquid',
      reason: `Selling ${usd} costs ${impact.toFixed(0)} bps, over a tenth of the position.`
    };
  }

  // The exit is measured and affordable, but the price it is measured against
  // may rest on very little. Say so rather than clearing the trade.
  if (input.measuredWeight < MIN_COVERAGE_FOR_VERDICT) {
    return {
      verdict: 'caution',
      reason: `${usd} fills at ${impact.toFixed(0)} bps, but under half the confidence model could be measured, so the price backing it is weakly corroborated.`
    };
  }

  if (impact >= IMPACT_TRADEABLE_BPS) {
    return {
      verdict: 'caution',
      reason: `Selling ${usd} costs ${impact.toFixed(0)} bps of slippage. Size accordingly.`
    };
  }

  if (input.flags.includes('single_pool')) {
    return {
      verdict: 'caution',
      reason: `${usd} fills at ${impact.toFixed(0)} bps, but a single venue prices this token and nothing corroborates it.`
    };
  }

  return {
    verdict: 'tradeable',
    reason: `${usd} fills at ${impact.toFixed(0)} bps against a price corroborated across venues.`
  };
}
