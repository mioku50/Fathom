# Fathom Architecture

Fathom is a paid API for Base long-tail token prices, liquidity, TWAP and confidence scoring.

## Core components

1. HTTP API
- /v1/price
- /v1/prices
- /v1/health

2. DEX adapters
- Aerodrome
- Uniswap v2/v3/v4

3. Pricing engine
- reads pools
- calculates spot price
- calculates TWAP
- calculates liquidity depth
- produces confidence score and flags

4. Cache
- KV/Redis cache for repeated requests
- short TTL for price data

5. Payment layer
- x402 USDC payments on Base
- free health endpoint
- paid price endpoints

## Production constraints

- no private keys in repo
- no production secrets in code
- all price responses must include confidence and flags
- thin liquidity must be clearly marked
