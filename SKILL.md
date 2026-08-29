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
GET /v1/price?token=<address>                    0.001 USDC
GET /v1/prices?tokens=<addr1,addr2,...>          0.003 USDC   up to 50 tokens
GET /v1/metadata?token=<address>                 symbol, name, decimals
GET /v1/metadatas?tokens=<addr1,addr2,...>
```

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
`no_measurable_signal`, `incomplete_pool_coverage`, `exit_liquidity_unverified`,
`hardcoded_numeraire`

Never conclude a token is bad from the second kind. `exit_liquidity_unverified`
means the exit was not established, not that none exists. If a decision hangs on
it, call again rather than acting on the gap.

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
| `404` `not_found` | No pools discovered for this token |
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
- No Uniswap v4 pools behind custom hooks, which need event indexing to discover

These are stated because an unmeasured signal reported as healthy is worse than
one reported as absent.
