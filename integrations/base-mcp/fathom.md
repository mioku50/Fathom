---
title: "Fathom Plugin"
description: "Pre-trade exit and risk assessment for Base tokens over an x402-paid HTTP API, routed through the Base MCP x402 payment tool."
tags: [trading, liquidity, risk-assessment, x402-payments]
name: fathom
version: 0.2.0
integration: http-api
chains: [base]
requires:
  shell: none
  allowlist: [fathom-api.mioku-fathom.workers.dev]
  externalMcp: null
  cliPackage: null
auth: none
risk: [irreversible]
---

# Fathom Plugin

> [!IMPORTANT]
> Run Base MCP onboarding first (see `SKILL.md`). Fathom charges 0.001 USDC per call over x402 on Base, so the wallet must be funded and each payment is approved through Base MCP before the paid request is retried.

## Overview

Fathom is a read-only execution and risk oracle for Base ERC-20 tokens. It answers one question — can this position be exited, at this size, at a price worth trusting — by quoting the exact sale on chain across five DEXes (Aerodrome, Aerodrome Slipstream, Uniswap V2/V3/V4) and returning a single verdict to branch on. For Coinbase tokenized stocks it also reads the B20 multiplier and pause state and compares the executable on-chain price against the equity's Chainlink reference. The plugin makes an HTTP call and returns data; it never builds calldata and never trades. The only Base MCP write it triggers is the x402 payment for the call itself.

**Supported chain:** Base (8453). Fathom reads no other chain and rejects `chain` values other than `base` before taking payment.

## Surface Routing

Fathom is HTTP-only. Every capability follows the standard HTTP routing in [../references/custom-plugins.md](../references/custom-plugins.md), with the addition that the first response is always `402` and a payment must be made before the answer exists.

| Capability | Path |
|---|---|
| Fetch payment terms (unpaid `402` probe) | Harness HTTP tool if available, else `web_request` GET against `fathom-api.mioku-fathom.workers.dev`. |
| Pay and retry (the actual assessment) | Harness HTTP tool or `web_request` GET carrying the `PAYMENT-SIGNATURE` header produced by the Base MCP x402 payment tool. |
| Read `SKILL.md` and the JSON schemas | Unpaid GET on either path; these routes are free. |

**Chat-only surfaces.** `web_request` reaches the host only once it is on the Base MCP allowlist. Where it is not, or where no x402 payment tool is exposed in the catalog, the agent must stop and tell the user that Fathom needs a payment-capable surface. Do not fall back to the user-paste path: an unpaid GET returns `402` and no assessment, so pasting the URL produces a payment challenge rather than an answer.

## Endpoints

All endpoints are `GET`, return `application/json`, and are priced per call in USDC over x402.

```
GET https://fathom-api.mioku-fathom.workers.dev/v1/assess?token=<0x…>&size_usd=<n>
```

| Endpoint | Price | Returns |
|---|---|---|
| `/v1/assess?token=&size_usd=` | 0.001 USDC | One verdict to branch on. **The primary route.** |
| `/v1/price?token=` | 0.001 USDC | Every measurement for one token. |
| `/v1/prices?tokens=` | 0.003 USDC | The same for up to 50 tokens, each with its own status. |
| `/v1/metadata?token=` | 0.001 USDC | Symbol, name and decimals read from the contract. |
| `/SKILL.md` | free | Agent capability description. |
| `/schemas/assess.output.json` | free | JSON Schema for the response below. |

**Parameters for `/v1/assess`:**

| Name | Required | Rule |
|---|---|---|
| `token` | yes | Base ERC-20 address, `0x` + 40 hex. |
| `size_usd` | no | The position to quote. 1 – 10,000,000; default 10,000. Quoted at exactly this size, never interpolated. |
| `chain` | no | `base` only. Anything else is rejected with `400` before payment is taken. |

**Response shape** (fields omitted here are in `/schemas/assess.output.json`):

```jsonc
{
  "verdict": "tradeable",          // tradeable | caution | illiquid | unverified
  "reason": "$10,000 fills at 48 bps against a price corroborated across venues.",
  "size_usd": 10000,
  "exit": { "fillable": true, "proceeds_usd": 9951.96, "price_impact_bps": 48.0 },
  "price_trust": { "confidence": 96, "measured_weight": 0.75, "sources": 6 },
  "concerns": [],                  // measured facts about the token — act on these
  "unverified": [],                // checks that did not run — never evidence against it
  "asset_type": "erc20"            // erc20 | b20_asset | b20_stock
}
```

For a Coinbase tokenized stock the response additionally carries `b20` (underlying, multiplier, corporate-action and pause state) and `stock_reference` (the Chainlink reference price and the premium or discount against it). Both are absent for an ordinary ERC-20.

**Status codes.** `200` is a paid measurement. `400` is a bad request, returned before payment. `402` carries the payment terms. `503` means Fathom could not measure — it is a failure to look, never a verdict on the token, and x402 does not settle on it.

## Orchestration

1. **Validate before paying.** Check `token` is `0x` + 40 hex and `size_usd` is within 1 – 10,000,000. A malformed request wastes a payment approval on a `400`.
2. **Probe for terms.** `GET /v1/assess?token=…&size_usd=…` with no payment header. The response is `402` with a `PAYMENT-REQUIRED` header carrying base64 JSON: `accepts[]` (scheme, network, asset, `payTo`, amount) plus a `builder-code` extension.
3. **Check the terms against the constants in [`## Notes`](#notes) before approving anything.** Scheme `exact`, network `eip155:8453`, asset Base USDC, `payTo` as listed, amount at or below 1000 atomic units. If any of them differs, stop and report it rather than paying — the terms come from whatever server answered.
4. **Pay.** Hand the challenge to the Base MCP x402 payment tool (see [`## Submission`](#submission)). Follow [../references/approval-mode.md](../references/approval-mode.md) for the returned approval URL and request ID.
5. **Retry with the signature.** Repeat the same GET with the `PAYMENT-SIGNATURE` header. Do not change the URL between the probe and the retry: the payment authorises that resource.
6. **Return the verdict, with its caveats attached.** Present `verdict` and `reason`, then `exit` and `price_trust`. Read `concerns` and `unverified` out separately — they are not interchangeable, and the difference is the point of the response (see [`## Notes`](#notes)).
7. **Never pay twice on your own initiative.** A `503` is not a reason to retry silently; ask the user first.

## Submission

Fathom returns data, not calldata, so nothing lands on `send_calls`.

- **The assessment itself:** no Base MCP submission tool. The agent issues the HTTPS GET, first unpaid and then with the `PAYMENT-SIGNATURE` header.
- **The x402 payment:** use the Base MCP x402 payment tool exposed by the MCP catalog. The payment must match the `accepts` entry from the live `402` exactly, and the `builder-code` extension declared in the challenge must be carried through into the signed payload — dropping it fails silently, with no error and no warning.

Do not use `send_calls` to hand-roll the EIP-3009 authorisation unless the Base MCP tool catalog explicitly documents that as the supported x402 payment path. Never ask for or use a private key.

## Example Prompts

**Can I get out of $25k of this token on Base?**

1. Validate the address and that 25000 is within range (`## Orchestration` step 1).
2. Probe `GET /v1/assess?token=0x…&size_usd=25000` for the `402` terms.
3. Check the terms against `## Notes`, pay through the Base MCP x402 tool, retry with the signature.
4. Report `verdict` and `reason`, then `exit.price_impact_bps` and `exit.proceeds_usd` for that exact size.
5. Read `concerns` and `unverified` out separately.

**Is TSLAc trading above or below the real TSLA price right now?**

1. Assess the token as above; `asset_type` comes back `b20_stock`.
2. Report `stock_reference.reference_price_usd` and `stock_reference.premium_discount_bps`, stating that positive is a premium.
3. Give `b20.multiplier` alongside it — one token is not permanently one share.
4. If `stock_reference.age_seconds` is large, say the equity market is closed and the comparison is against the last close, not a live quote.
5. Do not present the reference as the price the user would get: `exit` is what a sale returns.

**Fathom said "unverified" — is this token a scam?**

1. No. `unverified` means too little could be measured to judge, and is a reason to call again rather than a mark against the token.
2. Read `unverified[]` back to the user — it names what could not be established.
3. Offer a second call, and ask before spending another 0.001 USDC.

**Assess this token and then sell it for me**

1. Run the assessment.
2. Stop there. Fathom is observational; this plugin never executes a swap.
3. If the user wants to trade, hand off to a swap plugin or Base MCP `swap` as a separate, explicitly confirmed action.

## Risks & Warnings

- **`irreversible`** — every assessment spends real USDC on Base, and a settled x402 payment cannot be recalled. Confirm the per-call cost with the user the first time, never approve a payment whose terms differ from the constants in `## Notes`, and never loop or auto-retry on `503`. A batch over 50 tokens through `/v1/prices` costs 0.003 USDC; say so before running one.

## Notes

**Canonical payment terms**, verified against the live `402` challenge. Anything else is a reason to stop, not to pay:

| Field | Value |
|---|---|
| resource | `https://fathom-api.mioku-fathom.workers.dev/v1/assess` |
| scheme | `exact` |
| network | `eip155:8453` |
| asset | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Base USDC) |
| payTo | `0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909` |
| amount | 1000 atomic units (0.001 USDC) — a **ceiling**: accept at or below, reject above |
| builder code | `bc_tzj2linw`, declared as a `builder-code` extension |

**`concerns` and `unverified` are not interchangeable.** `concerns` are measurements about the token and should be acted on. `unverified` are checks that did not run — a failure to look, never a finding. Presenting the second as the first makes an agent reject good tokens for Fathom's own RPC failures.

**`unverified` is not a negative verdict.** It means too little could be measured to say, and the right response is to call again, not to avoid the token.

**`liquidity_usd` is `null` for concentrated-liquidity pools** and is deliberate. Those pools have no balance to report; the figure usually quoted is `L · sqrtP`, an active-range parameter that is not TVL. Use `exit` instead.

**No honeypot or transfer-tax simulation is run.** `sellability_unchecked` says so on every response. Fathom does not claim scam or honeypot protection.

**Tokenized stocks:** `stock_reference.reference_price_usd` is a Chainlink total-return value — the price of one token, with the multiplier already applied. Do not multiply it by `b20.multiplier` again. A configured transfer policy in `b20.policy_restricted` does not mean the holder is blocked; secondary trading is permissionless, and Fathom does not know the selling address.

**Base mainnet only.** No other chains, and no mint, redeem, or compliance-eligibility decision for tokenized stocks.
