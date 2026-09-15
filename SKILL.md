# Fathom

Base-native execution and risk oracle. Use it to decide whether a Base ERC-20
can be priced honestly and exited at size, before you act on that price.

## When to reach for it

Use Fathom when you are about to price, buy, sell, rebalance, or value a
position in a Base ERC-20 and a wrong answer would cost something. It is worth
the call when:

- the asset is long-tail, and major feeds either lack it or quote it without any
  sense of whether the market can absorb a sale
- you need to know what a sale actually returns, not what the mid-price implies
- you need independent venues to agree before you trust a number
- you need spot checked against the pool's own TWAP
- you are sizing a trade and price impact decides the size

Do not treat a spot price alone as sufficient for a long-tail token. A token can
quote at $0.02 across five sources and still return 8% less than that on a
$10,000 sale. That gap is the thing Fathom measures.

For a liquid major with a deep centralized market, an ordinary price feed is
cheaper and just as good. Fathom earns its fee where liquidity is the question.

## Endpoints

All are paid via x402 on Base (USDC, `exact` scheme, CDP facilitator).

```
GET /v1/assess?token=<address>&size_usd=<n>      0.001 USDC   one verdict
GET /v1/price?token=<address>                    0.001 USDC   everything measured
GET /v1/prices?tokens=<addr1,addr2,...>          0.003 USDC   up to 50 tokens
GET /v1/metadata?token=<address>                 symbol, name, decimals
GET /v1/metadatas?tokens=<addr1,addr2,...>
```

**Start with `/v1/assess`** unless you need the raw measurements. It answers the
question you probably have — *can I get out of this, at this size, at a price I
can trust?* — as a single word you can branch on.

```json
{
  "verdict": "tradeable",
  "reason": "$10,000 fills at 48 bps against a price corroborated across venues.",
  "size_usd": 10000,
  "exit": { "fillable": true, "proceeds_usd": 9951.96, "price_impact_bps": 48.0 },
  "price_trust": { "confidence": 96, "measured_weight": 0.75, "sources": 6 },
  "concerns": [],
  "unverified": ["No honeypot or transfer-tax simulation was run."]
}
```

| `verdict` | What to do |
|---|---|
| `tradeable` | The sale fills cheaply against a corroborated price. Proceed. |
| `caution` | It fills, at a cost worth knowing. Read `reason`, size down. |
| `illiquid` | It cannot be filled, or costs over a tenth of the position. Do not. |
| `unverified` | Too little could be measured to say. **Retry — this is not a negative.** |

Pass `size_usd` for the position you actually hold. It is quoted on chain at
exactly that size; Fathom will not interpolate between standard sizes, because a
guess about slippage is worse than no answer. Default 10000.

`concerns` are measured facts about the token — act on them. `unverified` are
checks that did not run — never treat them as evidence against the token.

Only Base mainnet is served. `chain` may be omitted or `base`; anything else is
rejected before payment is taken.

## Reading the answer

### Decide with these

| Field | What it tells you |
|---|---|
| `price_usd` | Spot, from the venue that can actually execute |
| `sell_quotes` | What selling $1k / $5k / $10k returns on chain, and the impact in bps |
| `confidence` | 0-100 |
| `measured_weight` | Share of the confidence model actually measured, 0-1 |
| `source_count` | Independent pools deep enough to count as a price source |
| `price_dispersion_bps` | How far those sources disagree |
| `twap` | The pool's own time-weighted price, and spot's deviation from it |
| `flags` | See below - two different kinds live here |

`confidence` alone is not enough. Read it together with `measured_weight`: a
score of 95 on `measured_weight` 0.35 rests on a third of the model. Anything
below 0.5 is capped and flagged rather than labelled reliable.

### Before a trade of any size, read `sell_quotes`

```json
"sell_quotes": [
  { "size_usd": 10000, "proceeds_usd": 9769.0, "price_impact_bps": 231.0 }
]
```

`price_impact_bps` is the cost of the exit you are contemplating. A `null`
`proceeds_usd` means that size could not be filled at all.

### Flags come in two kinds, and confusing them is expensive

**Measurements about the token** - act on these:

`thin_liquidity`, `no_exit_liquidity`, `possible_manipulation`, `single_pool`,
`stale`, `unsellable`

**Limits of what could be established** - these say something about the reading,
not about the token:

`twap_unavailable`, `freshness_unchecked`, `sellability_unchecked`,
`depth_unavailable`, `liquidity_unmeasured`, `low_measurement_coverage`,
`no_measurable_signal`, `incomplete_pool_coverage`, `incomplete_venue_coverage`,
`incomplete_quote_coverage`,
`exit_liquidity_unverified`,
`hardcoded_numeraire`

Never conclude a token is bad from the second kind. `exit_liquidity_unverified`
means the exit was not established, not that none exists. If a decision hangs on
it, call again rather than acting on the gap.

### Coinbase tokenized stocks

Base's B20 standard carries Coinbase's tokenized equities. For those, `/v1/assess`
adds `asset_type`, a `b20` block and a `stock_reference` block, and raw
`asset_flags` beside them. Everything else in the answer is unchanged, and for an
ordinary ERC-20 the three fields are simply absent.

```jsonc
{
  "asset_type": "b20_stock",
  "b20": {
    "underlying": "TSLA",
    "multiplier": 1.0,            // shares per token - NOT permanently 1
    "corporate_action_pending": false,
    "paused": false,
    "policy_restricted": false
  },
  "stock_reference": {
    "reference_price_usd": 357.88,
    "premium_discount_bps": 13.4, // Fathom's measured price vs the equity
    "source": "chainlink"
  }
}
```

Four things worth knowing before using them:

**One token is not one share.** `multiplier` is how many shares it redeems for,
and dividends and splits move it — GOOGLc already sits at 1.000377. A `null`
there means the read failed; it is never defaulted to 1.0.

**`reference_price_usd` is already the token's price.** The Chainlink feeds
publish total return, which is the underlying's price with the multiplier
applied. Multiplying by `multiplier` again double-counts every corporate action
the token has ever had.

**The reference does not replace `exit`.** `sell_quotes` remains the only number
that says what a sale returns. The premium says whether the venue is quoting the
equity rich or cheap, and it deliberately does not move the verdict.

**A frozen feed is normal.** The equity feed stops updating outside US market
hours, at weekends, on holidays, and while a corporate action is applied. Past
its 24-hour heartbeat it is marked `reference_price_stale` and reported under
`unverified`, because a closed market is not a fault of the token. `age_seconds`
says how old the comparison is.

The asset flags follow the same two-kind rule. `b20_transfer_paused` and
`corporate_action_pending` are measurements. `b20_policy_unverified`,
`b20_scheduled_update_unverified`, `corporate_action_unverified`,
`b20_metadata_unverified`, `reference_price_unavailable`, `reference_price_stale`
and `premium_unverified` are limits of the reading. `stock_premium_high` and
`stock_discount_high` are neither: they are observations about price.

A configured transfer policy is **not** a block. Secondary trading is
permissionless and those slots normally hold a sanctions blocklist; Fathom does
not know your address, so it reports that a policy exists and says explicitly
that applicability was not established.

### Nulls are deliberate

`liquidity_usd` is `null` for concentrated-liquidity pools. Those pools have no
balance to report - the on-chain figure is `L * sqrtP`, an active-range
parameter, not money sitting in the pool. Fathom returns null rather than
publishing a number that would look like TVL and is not. Use `sell_quotes` for
those tokens; it answers the question TVL was standing in for.

The same rule runs throughout: a component that was not measured is excluded
from the score rather than counted as healthy, and `measured_weight` reports how
much was.

## Errors

| Status | Meaning |
|---|---|
| `402` | Payment required; the challenge carries the terms |
| `503` `unpriceable` | No supported price source was measured; pool absence was not established |
| `503` `rpc_error` | Pools exist but could not be read - retry |
| `503` `stale_anchor` | The USD anchor was unavailable - retry |
| `503` `unknown_decimals` | The token's decimals could not be read; Fathom will not guess them |

A `503` is a failure to measure, never a verdict on the token.

## Batch

`/v1/prices` returns one entry per token, each with its own `status`, so a
single unreadable token does not cost you the rest of the list.

## What Fathom does not do

- No chains other than Base mainnet
- No honeypot or transfer-tax simulation yet; `sellability_unchecked` says so
- No pool age or 24h volume yet; the `maturity` component is always unmeasured
- No exhaustive Uniswap v4 hook discovery; pools behind custom hooks are indexed
  on demand, per token asked about, from a KV-backed event index rather than
  scanned across all historical deployments
- No mint or redeem of tokenized stocks, and no compliance eligibility check;
  Fathom reads a token's policy state but never decides whether an address may
  trade

These are stated because an unmeasured signal reported as healthy is worse than
one reported as absent.
