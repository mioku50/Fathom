# Fathom

**Base-native execution and risk oracle for AI agents.**

A price is only half an answer. Fathom tells you what a Base ERC-20 is worth
*and* what you would actually receive for selling it — measured on chain, across
five DEXes, at the size you care about.

```
GET https://fathom-api.mioku-fathom.workers.dev/v1/price?token=0x…
```

Paid per call over [x402](https://x402.org) on Base. 0.001 USDC, gasless,
settles in seconds. Discoverable through the x402 Bazaar.

- **[SKILL.md](SKILL.md)** — load Fathom as an agent capability
- **[docs/architecture.md](docs/architecture.md)** — how the numbers are produced
- **[Live service](https://fathom-api.mioku-fathom.workers.dev/)**

---

## Why this exists

Ask a typical price feed about a long-tail Base token and you get a number. You
do not get to know whether that number survives contact with a trade.

Two real tokens, priced by Fathom on the same request:

| | confidence | spot vs TWAP | selling $10,000 |
|---|---|---|---|
| cbBTC | 97 | 0.2 bps | **25 bps** of impact |
| DEGEN | 93 | 0.1 bps | **231 bps** of impact |

Both price cleanly. Both agree across venues. One costs nine times more to exit.
An agent sizing a position, valuing collateral, or deciding whether to enter at
all needs the second column, and almost nothing returns it.

That is the whole product.

## What you get

```jsonc
{
  "token": "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  "symbol": "AERO",
  "price_usd": 0.4842795431126595,

  "confidence": 96,
  "label": "reliable",
  "measured_weight": 0.75,        // how much of the model backs that 96

  "source_count": 6,              // independent pools that agreed
  "price_dispersion_bps": 39.7,

  "twap": {                       // the pool's own oracle, not spot rebranded
    "price_usd": 0.4842382979926149,
    "window_seconds": 300,
    "spot_deviation_bps": 0.85
  },

  "sell_quotes": [                // quoted on chain, fees and slippage included
    { "size_usd":  1000, "proceeds_usd":  995.91, "price_impact_bps": 40.9 },
    { "size_usd":  5000, "proceeds_usd": 4977.96, "price_impact_bps": 44.1 },
    { "size_usd": 10000, "proceeds_usd": 9951.96, "price_impact_bps": 48.0 }
  ],

  "liquidity_usd": null,          // deliberate — see below
  "main_pool": { "dex": "aerodrome_slipstream", "address": "0x4e50…" },
  "flags": ["freshness_unchecked", "sellability_unchecked", "liquidity_unmeasured"]
}
```

## The rule the whole codebase follows

**Never emit a number you cannot stand behind.**

It sounds obvious. In practice it means giving things up:

**`liquidity_usd` is `null` for most tokens.** Concentrated-liquidity pools have
no balance to report. The figure everyone quotes is `L · sqrtP`, an active-range
parameter that looks like TVL and is not one. Fathom returns null and points you
at `sell_quotes`, which answers the question TVL was standing in for.

**An unmeasured signal is excluded, not assumed healthy.** Confidence is a
weighted model; a component we could not measure has its weight redistributed
rather than scored as fine. `measured_weight` tells you what share of the model
was live. Below half, the answer is capped and cannot call itself reliable — a
score of 95 backed by a third of the model is a confident statement about very
little.

**A failure to look is not a finding.** Flags come in two kinds, and the API
says which: `thin_liquidity` and `no_exit_liquidity` are measurements about the
token; `incomplete_pool_coverage` and `exit_liquidity_unverified` mean we could
not see enough to judge. If discovery finds twenty pools and the reads return
one, Fathom withdraws the verdict instead of condemning a token on a twentieth
of its market.

**No price beats a wrong price.** A token whose decimals cannot be read returns
`503 unknown_decimals`, because a wrong decimals value silently rescales the
answer by orders of magnitude.

## One call, one decision

`/v1/price` returns everything measured and leaves the judgement to you.
`/v1/assess` makes it:

```
GET /v1/assess?token=0x940181…&size_usd=10000
```

```json
{
  "verdict": "tradeable",
  "reason": "$10,000 fills at 48 bps against a price corroborated across venues.",
  "exit": { "fillable": true, "proceeds_usd": 9951.96, "price_impact_bps": 48.0 },
  "price_trust": { "confidence": 96, "measured_weight": 0.75, "sources": 6 },
  "concerns": [],
  "unverified": ["No honeypot or transfer-tax simulation was run."]
}
```

Four verdicts: `tradeable`, `caution`, `illiquid`, and `unverified` — which
means *we could not measure enough to say*, and is a reason to retry rather than
a mark against the token. `concerns` and `unverified` stay separate for the same
reason: a failure to look is not a finding.

`size_usd` is quoted on chain at exactly the size you name. Fathom will not
interpolate between standard sizes, because a guess about slippage is worse than
no answer.

## Quickstart

Any x402 client works. With the [x402 fetch wrapper](https://www.npmjs.com/package/@x402/fetch):

```js
import { wrapFetchWithPayment } from '@x402/fetch'
import { privateKeyToAccount } from 'viem/accounts'

const account = privateKeyToAccount(process.env.PRIVATE_KEY)
const fetchWithPay = wrapFetchWithPayment(fetch, account)

const res = await fetchWithPay(
  'https://fathom-api.mioku-fathom.workers.dev/v1/price?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631'
)
const { price_usd, sell_quotes, flags } = await res.json()
```

Without a client, the unpaid request returns `402` with the terms in the
`PAYMENT-REQUIRED` header:

```bash
curl -sD- -o/dev/null 'https://fathom-api.mioku-fathom.workers.dev/v1/price?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631'
```

## API

| Endpoint | Price | Returns |
|---|---|---|
| `GET /v1/assess?token=&size_usd=` | 0.001 USDC | One verdict to branch on |
| `GET /v1/price?token=` | 0.001 USDC | Every measurement for one token |
| `GET /v1/prices?tokens=` | 0.003 USDC | Same, up to 50 tokens, each with its own status |
| `GET /v1/metadata?token=` | 0.001 USDC | Symbol, name, decimals, read from the contract |
| `GET /v1/metadatas?tokens=` | 0.003 USDC | The same in bulk |
| `GET /SKILL.md` | free | Agent capability description |

Base mainnet only. `chain` may be omitted or `base`; anything else is rejected
before payment is taken.

Errors are `503` when a measurement could not be made — `rpc_error`,
`stale_anchor`, `unknown_decimals` — and `404 not_found` when a token genuinely
has no pools. A `503` is never a verdict on the token.

Full field reference: **[SKILL.md](SKILL.md)**.

## How it works

```
DEX adapters ──► orchestrator ──► pricing engine ──► confidence model
     │                │                  │                  │
 5 venues       batched reads      anchors, depth,     weighted, with
 on Base        + caching          TWAP, dispersion    null-exclusion
```

**Venues:** Aerodrome (volatile *and* stable curves), Aerodrome Slipstream,
Uniswap V2, V3, and V4.

Some details that took real work:

- Aerodrome stable pools trade on `x³y + y³x = k`. Pricing them by reserve ratio
  is wrong by 944 bps on a live pool; Fathom uses the curve's actual marginal
  price, which matches the pool's own quoter to 5 bps — exactly the fee.
- Uniswap v4 pools live in a singleton with no address of their own. Their
  `PoolId` is derived off chain from the pool key.
- TWAP comes from each pool's own oracle via `observe()`, not from spot with a
  label on it.
- Slipstream factories are read from the on-chain `FactoryRegistry`, because the
  address the block explorers hand you is not in it and answers nothing.

More in [docs/architecture.md](docs/architecture.md).

## What it does not do

Stated plainly, because an unmeasured signal reported as healthy is worse than
one reported as absent:

- **Base mainnet only.** No other chains.
- **No honeypot or transfer-tax simulation.** `sellability_unchecked` says so on
  every response.
- **No pool age or 24h volume.** The `maturity` component is always unmeasured,
  which is why `measured_weight` tops out at 0.90.
- **No Uniswap v4 pools behind custom hooks.** Discovering those needs event
  indexing.

## Development

```bash
npm install
npm run typecheck
npx vitest run          # 761 tests
npx wrangler dev
```

Runs as a Cloudflare Worker. A scheduled job re-prices known tokens every 15
minutes and asserts invariants — WETH within a sane band, at least two
independent sources, at least one fillable quote, TWAP answering — so silent
degradation surfaces as a failed check rather than as a quietly worse number.

Configuration lives in `wrangler.toml`; secrets (`PRICE_RPC_URL`,
`ADMIN_AUTH_TOKEN`, CDP facilitator credentials) are set with
`npx wrangler secret put`.

## License

MIT
