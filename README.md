# Fathom

**Know the exit before you enter.**

Fathom is an x402-paid pre-trade assessment API for AI agents on Base.
Give it a token address and the position size you care about; Fathom measures
what that exit looks like on chain and returns one decision-ready verdict:

`tradeable` · `caution` · `illiquid` · `unverified`

The primary question is simple:

> **If an agent enters this Base token position, can it actually get back out at this size?**

- **Live API:** https://fathom-api.mioku-fathom.workers.dev
- **Agent capability:** [SKILL.md](SKILL.md)
- **Integration Kit:** [integrations/README.md](integrations/README.md)
- **Network:** Base mainnet
- **Payment:** USDC via x402

---

## Start here

```text
GET /v1/assess?token=<address>&size_usd=<position>
```

Price: **0.001 USDC** via x402.

Example:

```json
{
  "verdict": "tradeable",
  "reason": "$10,000 fills at 48 bps against a price corroborated across venues.",
  "size_usd": 10000,
  "exit": {
    "fillable": true,
    "proceeds_usd": 9951.96,
    "price_impact_bps": 48.0
  },
  "price_trust": {
    "confidence": 96,
    "measured_weight": 0.75,
    "sources": 6
  },
  "concerns": [],
  "unverified": [
    "No honeypot or transfer-tax simulation was run."
  ]
}
```

`size_usd` is quoted at the size requested. Fathom does not interpolate a
smaller quote into a larger one and present the result as measured.

## Why Fathom

A spot price is not an exit.

A Base token can have a plausible market price while a real sale at the size an
agent intends to hold produces materially less. Fathom keeps those questions
separate:

- **price trust** — whether the observed price is sufficiently corroborated;
- **exit liquidity** — whether the requested position can actually be sold and
  what the sale returns;
- **measurement limits** — what Fathom could not establish, kept separate from
  findings about the token itself.

That last distinction matters. `unverified` does **not** mean bad, unsafe, or
illiquid. It means the available measurement was not sufficient to make that
claim.

## Verdicts

| Verdict | Meaning |
|---|---|
| `tradeable` | The requested exit fills cheaply against a sufficiently corroborated price. |
| `caution` | The exit fills, but the measured cost is material enough to inspect or resize. |
| `illiquid` | The requested exit cannot be filled economically, or cannot be filled at all. |
| `unverified` | Fathom could not measure enough to make a reliable market verdict. |

Fathom is an assessment primitive. It does **not** automatically buy, sell, or
route a trade.

## Coinbase tokenized stocks / B20

Fathom is B20-aware for Coinbase tokenized stocks on Base.

For verified B20 equities such as AAPLc, NVDAc and TSLAc, `/v1/assess` can add
stock-specific context alongside the normal executable exit measurement:

```jsonc
{
  "asset_type": "b20_stock",
  "b20": {
    "underlying": "NVDA",
    "multiplier": 1.0,
    "corporate_action_pending": false,
    "paused": false
  },
  "stock_reference": {
    "reference_price_usd": 213.03,
    "premium_discount_bps": -10.8,
    "source": "chainlink"
  }
}
```

The stock reference never replaces the executable exit quote. One describes the
reference value of the tokenized equity; the other describes what the onchain
market will actually return at the requested size.

Fathom also distinguishes a verified Coinbase stock from an arbitrary B20 asset.
B20 itself is permissionless, so B20 detection alone is not treated as proof
that a token represents an equity.

## API

| Endpoint | Price | Purpose |
|---|---:|---|
| `GET /v1/assess?token=&size_usd=` | 0.001 USDC | Primary pre-trade verdict and exact-size exit assessment |
| `GET /v1/price?token=` | 0.001 USDC | Detailed measurements for one token |
| `GET /v1/prices?tokens=` | 0.003 USDC | Batch measurements for up to 50 tokens |
| `GET /v1/metadata?token=` | 0.001 USDC | Token metadata |
| `GET /v1/metadatas?tokens=` | 0.003 USDC | Batch token metadata |
| `GET /SKILL.md` | free | Agent-facing capability description |

Base mainnet only. Unsupported chains are rejected before payment is taken.

A `503` means Fathom could not establish a measurement; it is not silently
converted into a negative token verdict.

## Agent integrations

The [Fathom Integration Kit](integrations/README.md) provides reusable ways to
call the same canonical assessment API from agent runtimes:

- TypeScript client
- x402 payment transport
- Coinbase AgentKit action
- LangChain tool
- Base MCP plugin candidate
- shared Hermes / OpenClaw AgentSkill
- CLI bridge

All adapters use the same assessment contract rather than maintaining separate
framework-specific interpretations of Fathom.

Fathom is also listed and routable through Agent402.

## Coverage

Fathom measures supported Base DEX liquidity across Aerodrome, Slipstream and
Uniswap V2/V3/V4, including on-demand discovery for custom-hook V4 pools.

The service is designed for long-tail Base assets where execution quality and
market depth matter more than simply obtaining another spot-price number.

## Boundaries

Fathom currently does **not** claim to provide:

- chains other than Base mainnet;
- honeypot or transfer-tax simulation;
- investment recommendations;
- automatic trade execution;
- B20 mint/redeem eligibility or address-specific compliance decisions;
- exhaustive knowledge of every possible liquidity venue on Base.

Missing or incomplete evidence is surfaced as missing or unverified rather than
silently assumed healthy or unhealthy.

## Development

```bash
npm ci
npm run typecheck
npx vitest run
```

The Integration Kit has its own verification suite under `integrations/`.

## License

MIT
