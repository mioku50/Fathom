import { DEXAdapter, PoolInfo, RawPoolData, SellQuoteRequest, TwapRequest, TwapResult } from './dex_adapter';
import { mapWithConcurrency } from './concurrency';

/**
 * How many pools may be read at once.
 *
 * A single token can now sit in 30+ pools across five DEXes, and firing one
 * multicall per pool simultaneously gets nearly all of them rate-limited - which
 * looks like "no liquidity" rather than like a failure. Reads are bounded so a
 * well-covered token does not defeat its own discovery.
 */
const RAW_DATA_CONCURRENCY = 4;

export interface PoolWithRawData {
  pool: PoolInfo;
  rawData: RawPoolData;
}

export interface CacheLayer {
  get(key: string): Promise<any>;
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;
}

/**
 * Orchestrates multiple DEX adapters to fetch pool information and raw data concurrently.
 * Handles caching and partial adapter failures to ensure robustness.
 */
export class DEXOrchestrator {
  private adapters: DEXAdapter[];
  private cache?: CacheLayer;

  /**
   * Constructs a new DEXOrchestrator instance.
   * @param adapters An array of DEXAdapters to be used by the orchestrator.
   * @param cache An optional cache layer for caching pool data.
   */
  constructor(adapters: DEXAdapter[], cache?: CacheLayer) {
    this.adapters = adapters;
    this.cache = cache;
  }

  /**
   * Discovers all pools across all registered adapters concurrently.
   * @param tokenAddress The ERC-20 token contract address (0x...).
   * @returns A promise that resolves to an aggregated array of PoolInfo objects.
   */
  async getAllPools(tokenAddress: string): Promise<PoolInfo[]> {
    const cacheKey = `orchestrator:pools:${tokenAddress.toLowerCase()}`;
    if (this.cache) {
      const cachedPools = await this.cache.get(cacheKey);
      if (cachedPools) {
        return cachedPools as PoolInfo[];
      }
    }

    const promises = this.adapters.map(adapter => adapter.getPools(tokenAddress));
    const results = await Promise.allSettled(promises);

    const allPools: PoolInfo[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allPools.push(...result.value);
      } else {
        console.error('Error fetching pools from an adapter:', result.reason);
      }
    }

    if (this.cache && allPools.length > 0) {
      await this.cache.set(cacheKey, allPools, 3600); // Cache for 1 hour
    }

    return allPools;
  }

  /**
   * Asks the adapter that owns `pool` to quote sells on-chain.
   * Returns null when that DEX has no quoter wired up, which the caller must
   * report as unknown rather than substitute with an estimate.
   */
  async quoteSell(request: SellQuoteRequest): Promise<(bigint | null)[] | null> {
    const adapter = this.adapters.find(a => a.id === request.pool.dex);
    if (!adapter?.quoteSell) return null;

    try {
      return await adapter.quoteSell(request);
    } catch (error) {
      console.error(`Error quoting sell on ${request.pool.dex} pool ${request.pool.address}:`, error);
      return null;
    }
  }

  /**
   * Asks the pool's own oracle for a time-weighted average price.
   * null when that DEX has no oracle wired up, or the pool cannot answer.
   */
  async getTwapAmountOut(request: TwapRequest): Promise<TwapResult | null> {
    const adapter = this.adapters.find(a => a.id === request.pool.dex);
    if (!adapter?.getTwapAmountOut) return null;

    try {
      return await adapter.getTwapAmountOut(request);
    } catch (error) {
      console.error(`Error reading TWAP on ${request.pool.dex} pool ${request.pool.address}:`, error);
      return null;
    }
  }

  /**
   * Fetches raw data for a list of pools concurrently.
   * Gracefully handles failures for individual pools.
   * @param pools An array of PoolInfo objects to fetch data for.
   * @returns A promise that resolves to an array of objects containing both pool info and its raw data.
   */
  async getAllRawData(pools: PoolInfo[]): Promise<PoolWithRawData[]> {
    if (pools.length === 0) return [];

    const rawKey = (pool: PoolInfo) => `orchestrator:raw:${pool.address.toLowerCase()}`;
    const resolved = new Map<string, RawPoolData>();

    // 1. Serve whatever the cache already holds.
    const misses: PoolInfo[] = [];
    if (this.cache) {
      const cached = await mapWithConcurrency(pools, RAW_DATA_CONCURRENCY, async pool => {
        try {
          return await this.cache!.get(rawKey(pool));
        } catch {
          return null;
        }
      });
      pools.forEach((pool, i) => {
        if (cached[i]) resolved.set(pool.address, cached[i] as RawPoolData);
        else misses.push(pool);
      });
    } else {
      misses.push(...pools);
    }

    // 2. Read the rest one DEX at a time. Pools on the same DEX share an ABI,
    // so an adapter that can batch reads them all in a single round trip
    // instead of one per pool - the burst that was getting throttled.
    const byDex = new Map<string, PoolInfo[]>();
    for (const pool of misses) {
      const group = byDex.get(pool.dex);
      if (group) group.push(pool);
      else byDex.set(pool.dex, [pool]);
    }

    const fetched: { pool: PoolInfo; rawData: RawPoolData }[] = [];

    for (const [dex, group] of byDex) {
      const adapter = this.adapters.find(a => a.id === dex);
      if (!adapter) {
        console.warn(`No adapter found for DEX: ${dex}`);
        console.error('Error fetching raw data for a pool:', new Error(`No adapter found for DEX: ${dex}`));
        continue;
      }

      if (adapter.getRawDataBatch) {
        try {
          const rows = await adapter.getRawDataBatch(group);
          group.forEach((pool, i) => {
            const rawData = rows[i];
            if (rawData) fetched.push({ pool, rawData });
          });
          continue;
        } catch (error) {
          // Fall through to per-pool reads rather than losing the whole DEX.
          console.error(`Batch read failed for ${dex}, falling back to per-pool:`, error);
        }
      }

      const rows = await mapWithConcurrency(group, RAW_DATA_CONCURRENCY, async pool => {
        try {
          return { pool, rawData: await adapter.getRawData(pool.address, pool) };
        } catch (error) {
          console.error('Error fetching raw data for a pool:', error);
          return null;
        }
      });
      for (const row of rows) if (row) fetched.push(row);
    }

    // 3. Write back what we read, without blocking the caller on cache writes.
    if (this.cache) {
      await Promise.allSettled(
        fetched.map(({ pool, rawData }) => this.cache!.set(rawKey(pool), rawData, 60))
      );
    }
    for (const { pool, rawData } of fetched) resolved.set(pool.address, rawData);

    // Preserve the caller's ordering.
    return pools
      .filter(pool => resolved.has(pool.address))
      .map(pool => ({ pool, rawData: resolved.get(pool.address)! }));
  }

}
