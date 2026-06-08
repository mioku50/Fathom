# Fathom Architecture

Fathom is a paid API for Base long-tail token prices, liquidity, TWAP and confidence scoring.

## API Boundary

Fathom provides a RESTful API for fetching token prices and liquidity data. It follows the x402 payment protocol for monetization.

### Endpoints

- `GET /v1/price`: Fetch price and confidence data for a single token.
- `GET /v1/prices`: Batch fetch prices for multiple tokens.
- `GET /v1/health`: Service health check (free, no payment required).

### Request Parameters (`/v1/price`)

| Parameter | Required | Default | Description |
| --- | --- | --- | --- |
| `token` | Yes | — | ERC-20 token contract address (0x...) |
| `chain` | No | `base` | Target blockchain network |
| `quote` | No | `usd` | Quote currency (`usd`, `eth`, `usdc`) |
| `twap_window` | No | `5m` | TWAP calculation window (`1m`, `5m`, `1h`) |
| `include` | No | — | Additional fields (`pools`, `history`) |

### Headers

- `X-PAYMENT`: x402 payment payload for paid requests.
- `Authorization`: Bearer token for enterprise/batch clients.

### Response Formats

#### Success Response (`200 OK`)

```json
{
  "token": "0xABC...",
  "chain": "base",
  "symbol": "PEPECOIN",
  "price_usd": 0.00004217,
  "price_low": 0.00004102,
  "price_high": 0.00004331,
  "twap_5m": 0.00004198,
  "confidence": 73,
  "label": "thin",
  "liquidity_usd": 84200,
  "main_pool": { "dex": "aerodrome", "address": "0x...", "fee": 0.003 },
  "pools": [...],
  "flags": ["thin_liquidity"],
  "updated_at": "2026-06-08T14:50:00Z"
}
```

#### Error Response

| HTTP Code | Error Code | Reason |
| --- | --- | --- |
| 400 | `invalid_request` | Invalid parameters or address format |
| 402 | `payment_required` | Payment via x402 required |
| 404 | `token_not_found` | No pools found for the token |
| 422 | `no_liquidity` | Pools exist but price cannot be calculated |
| 429 | `rate_limited` | Free tier or API limits exceeded |
| 500 | `internal_error` | Internal server error |
| 503 | `rpc_unavailable` | External RPC nodes are unresponsive |

## Core components

1. HTTP API
- Handles request routing and x402 payment verification.
- Enforces rate limits and API key validation.

2. DEX adapters
- Aerodrome (v2 + Slipstream)
- Uniswap (v2, v3, v4)
- Adapters follow a standard `DEXAdapter` interface:
  - `getPools(tokenAddress)`: Discover all relevant pools for a token.
  - `getRawData(poolAddress)`: Fetch reserves, ticks, or state for price/liquidity calculation.
- Discovery logic uses Factory and Registry contracts to locate pools programmatically.

3. Pricing engine
- Orchestrates price discovery by querying DEX adapters.
- **Liquidity Depth**: Calculates TVL and slippage depth (how much $ moves price by 1%).
- **TWAP**: Uses historical ticks/reserves to calculate time-weighted average price (default 5m window).
- **Confidence Scoring**: Produces a 0-100 score based on a weighted formula:
  - `0.35 * S_liq` (Liquidity depth)
  - `0.20 * S_src` (Price consistency across sources)
  - `0.20 * S_twap` (Spot vs TWAP deviation)
  - `0.15 * S_sigma` (Price volatility/uncertainty)
  - `0.10 * S_mat` (Market maturity: age and volume)
- **Risk Flags**: Hard ceilings applied to confidence score:
  - `thin_liquidity`: Liquidity below minimum threshold.
  - `possible_manipulation`: Large spot/TWAP deviation.
  - `single_pool`: Only one liquidity source found.
  - `stale`: Data is outdated or RPC is failing.
  - `unsellable`: Sell simulation reverts (honeypot check).

4. Cache
- **Storage**: Uses Cloudflare KV or Upstash Redis for fast lookups.
- **Strategy**:
  - Token metadata: Long TTL (hours).
  - Price/Confidence data: Short TTL (seconds) to ensure fresh data.
  - Reduces RPC costs and latency for repeated requests for the same token.

5. Payment layer (x402)
- Implements the x402 protocol:
  1. Client sends a request without payment.
  2. Server responds with `402 Payment Required` and payment parameters.
  3. Client pays USDC on Base network and signs the proof.
  4. Client retries request with `X-PAYMENT` header.
  5. Server verifies payment against Base L2 before returning price data.

## Production constraints

- No private keys in repo.
- No production secrets in code.
- All price responses must include confidence and flags.
- Thin liquidity must be clearly marked.

## Production Risks

- **Price Manipulation**: Low-liquidity pools can be manipulated to skew spot price. mitigated by TWAP and confidence scoring.
- **RPC Reliability**: Dependency on public/shared RPC nodes for on-chain data. Mitigated by caching and multiple RPC fallbacks.
- **Data Staleness**: Rapid price movements might not be captured if cache TTL is too high.

## Non-goals

- **Cross-chain support**: MVP is strictly focused on Base network.
- **Sub-second Latency**: Fathom is optimized for reliability and confidence, not high-frequency trading.
- **Order Execution**: Fathom is a read-only price oracle, it does not execute swaps.
