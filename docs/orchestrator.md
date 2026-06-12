# Pricing Orchestrator Architecture

The Pricing Orchestrator (`src/orchestrator.ts`) is a core component in Fathom responsible for aggregating pricing and liquidity data across multiple Decentralized Exchanges (DEXes) concurrently. It acts as the central coordinator between the `PriceReader` (which decides the *best* price) and the individual `DEXAdapter` implementations (which interact with specific DEX contracts like Uniswap V3 or Aerodrome).

## Core Responsibilities

1. **Adapter Management**
   The orchestrator maintains a collection of registered `DEXAdapter` instances. When queried for a token, it delegates the discovery of relevant liquidity pools to all registered adapters.

2. **Concurrent Pool Discovery**
   The `getAllPools(tokenAddress: string)` method queries all adapters simultaneously using `Promise.allSettled`. This concurrency minimizes latency when fetching pool metadata (addresses, fees, DEX identifiers) across multiple protocols.

3. **Data Fetching and Fault Tolerance**
   To ensure robustness, the orchestrator handles partial adapter failures gracefully. Because it uses `Promise.allSettled` instead of `Promise.all`, a failure or timeout in one adapter (e.g., if a specific DEX's RPC endpoint fails) will not crash the entire query. The orchestrator simply logs the error and proceeds with the successful results from the other adapters.

   The `getAllRawData(pools: PoolInfo[])` method follows a similar resilient pattern. It maps each discovered pool back to its responsible adapter and fetches the raw state data (reserves, ticks, liquidity) required for price calculation.

4. **Caching**
   To reduce RPC calls and improve performance, the orchestrator integrates an optional `CacheLayer`.
   - **Pool Discovery Cache**: Discovered pools for a given token are cached (typically for 1 hour), as the existence of pools rarely changes.
   - **Raw Data Cache**: The raw state of individual pools (reserves/ticks) is highly volatile and is cached for a much shorter duration (e.g., 60 seconds) to ensure price accuracy while mitigating rate limits.

## Component Relationships

- **`PriceReader`**: The consumer of the orchestrator. It calls `getAllPools` and `getAllRawData`, then feeds the raw data into the `PriceCalculator` to determine the best available price and liquidity.
- **`DEXAdapter`**: The interface implemented by protocol-specific adapters. The orchestrator delegates the actual RPC calls to these adapters.
- **`CacheLayer`**: An interface providing `get` and `set` methods, allowing the orchestrator to store and retrieve data efficiently.

## Summary Flow

1. `PriceReader` requests data for Token X.
2. `DEXOrchestrator` checks cache for known pools for Token X.
3. On cache miss, `DEXOrchestrator` queries all `DEXAdapter`s concurrently to find pools.
4. `DEXOrchestrator` checks cache for the raw data of the discovered pools.
5. On cache miss, `DEXOrchestrator` queries the respective `DEXAdapter`s concurrently for raw data (reserves, liquidity).
6. The aggregated `PoolWithRawData` array is returned to the `PriceReader` for evaluation.
