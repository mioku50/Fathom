# Fathom Architecture

Fathom is a paid API for Base long-tail token prices, liquidity, TWAP and confidence scoring. This document outlines the architecture, data flows, and constraints of the system.

## API Boundary

The HTTP API is the primary interface for clients. It consists of three endpoints:

1. `GET /v1/price`: Fetches the price, liquidity, TWAP, and confidence score for a single token. Requires x402 payment or an API key, unless within a free-tier limit.
2. `GET /v1/prices`: A batch endpoint for fetching prices of multiple tokens in a single request. Requires x402 payment or an API key.
3. `GET /v1/health`: A free endpoint for checking the service status, uptime, and latency.

## DEX Adapters

The system interacts with decentralized exchanges (DEXs) like Aerodrome and Uniswap via a standardized adapter interface. All DEX adapters must implement the `DEXAdapter` interface, which includes the following core methods:

- `getPools(tokenAddress)`: Discovers and returns all liquidity pools containing the target token on the specific DEX.
- `getRawData(poolAddress)`: Fetches the raw reserves, ticks, or state necessary to compute the current spot price and liquidity for a given pool.

## Pricing Engine and Confidence Scoring

The pricing engine aggregates data from the DEX adapters to compute a unified price and a confidence score.

The confidence score (0 to 100) is calculated using a weighted formula:

`Confidence = 0.35 * S_liq + 0.20 * S_src + 0.20 * S_twap + 0.15 * S_sigma + 0.10 * S_mat`

Where:
- `S_liq` (Liquidity Score): Based on the total tradeable liquidity depth across all pools.
- `S_src` (Source Deviation): Consistency of price across different DEXs and pools.
- `S_twap` (TWAP Deviation): Deviation of the current spot price from the Time-Weighted Average Price.
- `S_sigma` (Volatility): Recent price volatility (sigma/mu).
- `S_mat` (Market Maturity): Age of the token's primary liquidity pools.

Risk flags are applied to cap the confidence score in specific scenarios (e.g., thin liquidity, stale data, manipulation-like patterns).

## Cache Logic

To handle high read volume and minimize RPC load/latency, Fathom uses a caching layer (e.g., Cloudflare KV or Upstash Redis):
- Repeated requests for the same token within a short timeframe hit the cache.
- Price data uses a short Time-To-Live (TTL) to ensure freshness while protecting backend RPCs.
- This effectively cuts down cost and improves latency for frequently requested tokens.

## x402 Payment Flow

Fathom monetizes via x402, enabling micro-payments in USDC on the Base blockchain for individual API calls.

1. **Request:** Client makes a request to `/v1/price` without a payment header.
2. **Challenge (402):** The server responds with `402 Payment Required`, including the required payment amount and conditions in the response body.
3. **Payment:** The client signs a payment transaction satisfying the conditions and includes the signature payload in the `X-PAYMENT` header.
4. **Verification & Response:** The server verifies the `X-PAYMENT` payload. If valid, the payment is processed, and the server responds with a `200 OK` and the requested price data.

## Deployment Assumptions

- **Serverless Edge:** The API is designed to be deployed on a serverless edge platform (e.g., Cloudflare Workers or Vercel Edge Functions) to provide low latency and horizontal scalability.
- **Stateless Handlers:** The application logic is stateless. State is only maintained in the external Cache and the blockchain (via RPC).
- **Free-Tier Infrastructure:** The initial MVP relies on free-tier infrastructure (e.g., public RPCs, free KV/Redis tiers) to maintain zero upfront running costs.

## Production Risks and Non-Goals

### Production Risks
- **RPC Rate Limits:** Heavy traffic could exhaust public RPC limits. Mitigation: Aggressive caching and fallback RPC providers.
- **Thin Liquidity Manipulation:** Prices of long-tail tokens can be easily manipulated. Mitigation: TWAP integration, strict confidence scoring, and explicit risk flags.
- **DEX Smart Contract Changes:** Upgrades to underlying DEX protocols could break adapters. Mitigation: Strict adapter interfaces and active monitoring of DEX ecosystems.

### Non-Goals
- Fathom is **not** a general-purpose indexer. It does not provide historical charts, tick-by-tick order book data, or generic blockchain scanning.
- Fathom is **not** an automated trading bot. It provides read-only data and confidence metrics.
- Fathom does **not** host its own blockchain nodes. It relies on third-party RPC providers for on-chain data.
