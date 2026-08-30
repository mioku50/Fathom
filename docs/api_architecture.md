# Fathom API Architecture

This document provides a high-level overview of Fathom's API design, which is a RESTful API for fetching token prices and liquidity data on Base network, utilizing the x402 payment protocol for monetization.

## API Boundary

Fathom provides endpoints to fetch price, liquidity, TWAP, and confidence scoring for Base long-tail tokens. The endpoints follow REST principles and return JSON responses.

## Endpoints

- `GET /v1/price`: Fetch price and confidence data for a single token.
- `GET /v1/prices`: Batch fetch prices for multiple tokens.
- `GET /v1/health`: Service health check (free, no payment required).

## Request Parameters (`/v1/price`)

| Parameter | Required | Default | Description |
| --- | --- | --- | --- |
| `token` | Yes | — | ERC-20 token contract address (0x...) |
| `chain` | No | `base` | Target blockchain network |
| `quote` | No | `usd` | Quote currency (`usd`, `eth`, `usdc`) |
| `twap_window` | No | `5m` | TWAP calculation window (`1m`, `5m`, `1h`) |
| `include` | No | — | Additional fields (`pools`, `history`) |

## Headers

- `X-PAYMENT`: x402 payment payload for paid requests.
- `Authorization`: Bearer token for enterprise/batch clients.

## Response Formats

### Success Response (`200 OK`)

A typical successful response contains the token details, calculated prices, confidence score, and liquidity information. For the exact JSON schema, please refer to [docs/api_schema.md](api_schema.md).

### Error Responses

The API uses standard HTTP error codes:

| HTTP Code | Error Code | Reason |
| --- | --- | --- |
| 400 | `invalid_request` | Invalid parameters or address format |
| 402 | `payment_required` | Payment via x402 required |
| 503 | `unpriceable` | No supported price source was measured; this is not proof that no pool exists |
| 422 | `no_liquidity` | Pools exist but price cannot be calculated |
| 429 | `rate_limited` | Free tier or API limits exceeded |
| 500 | `internal_error` | Internal server error |
| 503 | `rpc_unavailable` | External RPC nodes are unresponsive |

## Request Lifecycle

1. **Client Request**: The client sends a GET request to `/v1/price` with a target token.
2. **Rate Limiting**: The request passes through a rate limiter. If limits are exceeded, a `429 Too Many Requests` is returned.
3. **Authentication/Payment (x402)**:
    * For paid endpoints, the API checks for the `X-PAYMENT` header.
    * If missing or invalid, the server responds with a `402 Payment Required` and the payment parameters.
    * The client pays USDC on Base, signs the proof, and retries with the valid `X-PAYMENT` header.
4. **Caching**:
    * The system checks the Cloudflare KV cache.
    * **Cache Hit**: Returns cached data immediately (short TTL for prices).
    * **Cache Miss**: Forwards the request to the Origin Pricing Engine.
5. **Origin Pricing Engine**:
    * Discovers pools via DEX adapters.
    * Fetches raw data via Base RPC.
    * Calculates price, depth, TWAP, and confidence score.
6. **Response**: Data is saved back to the cache and returned to the client as a `200 OK`.
