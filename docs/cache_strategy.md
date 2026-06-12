# Fathom Cache Strategy

Fathom relies heavily on caching to minimize RPC calls, guarantee low latency, and reduce costs. The caching layer is primarily powered by Cloudflare KV.

## KV Cache Layer (`src/cache.ts`)

The `KVCacheLayer` class handles the core logic for caching price data and token metadata.

### Keys and Namespaces

Cache keys are generated using a consistent format to prevent collisions:
- **Price Data**: `price:{chain}:{token}` (e.g., `price:base:0x...`)
- **Metadata**: `metadata-{chain}-{token}` (handled in `src/index.ts`)

### Time-To-Live (TTL) Strategy

Different types of data require different freshness guarantees:

1.  **Token Metadata (Long TTL)**
    - Default: Typically hours.
    - Token metadata (like symbol, decimals, name) rarely changes, so it can be cached for extended periods.

2.  **Price / Confidence Data (Short TTL)**
    - Default: `60` seconds (configurable via `CACHE_DEFAULT_TTL_SECONDS` or passed explicitly).
    - Ensures the API returns fresh data reflecting recent market movements while still shielding RPCs from a barrage of identical requests.

3.  **Pool Discovery (Medium TTL)**
    - Default: `3600` seconds (1 hour) in the `orchestrator.ts`.
    - Pool addresses don't change often, but new pools might be created.

### Failovers and Error Handling

To ensure the cache layer never breaks the core API functionality:

- **Soft Failures**: Cache read and write errors are explicitly caught and logged (e.g., `console.error('KV Cache read error:', e)`).
- **Graceful Degradation**: If `FATHOM_KV` is unconfigured or a KV operation fails, the system seamlessly falls back to fetching fresh data from the Origin (Pricing Engine). The API will continue to serve requests, albeit with potentially higher latency and RPC usage.

### Metrics Tracking

The cache layer tracks global `hits` and `misses` to monitor efficiency.
- These metrics are exposed via the `/v1/cache/stats` endpoint.
- Cache hit/miss status is also logged to the console for individual requests (e.g., `[Cache] HIT - price:base:0x...`).

## Invalidation

Cache invalidation routes are provided to force freshness when needed (protected by x402 middleware):
- `/v1/cache/invalidate`: Clears the cache for a specific token/chain.
- `/v1/cache/clear/pool`: Clears the pool discovery cache.
- `/v1/cache/clear`: Clears the entire KV namespace.
