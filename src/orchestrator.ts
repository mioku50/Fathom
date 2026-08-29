import { DEXAdapter, PoolInfo, RawPoolData, SellQuoteRequest, TwapRequest, TwapResult } from './dex_adapter';
import { mapWithConcurrency } from './concurrency';
import { keccak256, toHex } from 'viem';

/**
 * How many pools may be read at once.
 *
 * A single token can now sit in 30+ pools across five DEXes, and firing one
 * multicall per pool simultaneously gets nearly all of them rate-limited - which
 * looks like "no liquidity" rather than like a failure. Reads are bounded so a
 * well-covered token does not defeat its own discovery.
 */
const RAW_DATA_CONCURRENCY = 4;

/**
 * How long a pool list may be reused when some adapters failed to answer.
 * Short enough that a throttled moment does not become the hour's truth.
 */
const PARTIAL_DISCOVERY_TTL_SECONDS = 60;

/**
 * Cache key for the raw data of a whole pool set.
 *
 * Exported so callers and tests address the entry the same way the orchestrator
 * does, rather than reconstructing a hash by hand.
 */
export function rawSetCacheKey(pools: PoolInfo[]): string {
  return `orchestrator:raw:${keccak256(
    toHex(pools.map(p => p.address.toLowerCase()).sort().join(','))
  )}`;
}

/**
 * How complete a discovery pass was. Adapters fail independently, so a token
 * can come back with pools from one venue while four others were throttled -
 * which is not the same as a token that only trades on one venue.
 */
export interface DiscoveryReport {
  adaptersTotal: number;
  adaptersFailed: number;
}

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
  async getAllPools(tokenAddress: string, report?: DiscoveryReport): Promise<PoolInfo[]> {
    const cacheKey = `orchestrator:pools:${tokenAddress.toLowerCase()}`;
    if (report) {
      report.adaptersTotal = this.adapters.length;
      report.adaptersFailed = 0;
    }

    if (this.cache) {
      const cachedPools = await this.cache.get(cacheKey);
      if (cachedPools) {
        return cachedPools as PoolInfo[];
      }
    }

    const promises = this.adapters.map(adapter => adapter.getPools(tokenAddress));
    const results = await Promise.allSettled(promises);

    const allPools: PoolInfo[] = [];
    let failed = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allPools.push(...result.value);
      } else {
        failed++;
        console.error('Error fetching pools from an adapter:', result.reason);
      }
    }
    if (report) report.adaptersFailed = failed;

    // Only a complete discovery is worth remembering for an hour.
    //
    // A throttled provider can take four of the five adapters down, leaving a
    // token that trades on Slipstream looking like it lives in one thin V2 pool.
    // Caching that froze the impoverished view for the full hour, so every
    // subsequent request repeated it - identically, which made it look like a
    // fact about the token rather than a moment of bad luck.
    if (this.cache && allPools.length > 0) {
      const ttl = failed === 0 ? 3600 : PARTIAL_DISCOVERY_TTL_SECONDS;
      await this.cache.set(cacheKey, allPools, ttl);
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

    // One entry for the whole pool set, not one per pool.
    //
    // Per-pool keys cost a read and a write for every pool in the set, and a
    // well-covered token now sits in thirty-odd of them. That is 33 writes per
    // uncached token, against a free-tier allowance of 1,000 a day - the
    // scheduled check alone would spend it several times over. The set a caller
    // asks for is deterministic per token, so keying on the set collapses that
    // to one read and one write while keeping the same hit rate.
    const rawKey = rawSetCacheKey(pools);
    const resolved = new Map<string, RawPoolData>();

    // 1. Serve whatever the cache already holds.
    const misses: PoolInfo[] = [];
    let cachedSet: Record<string, RawPoolData> | null = null;
    if (this.cache) {
      try {
        cachedSet = (await this.cache.get(rawKey)) as Record<string, RawPoolData> | null;
      } catch {
        cachedSet = null;
      }
    }
    if (cachedSet) {
      for (const pool of pools) {
        const hit = cachedSet[pool.address.toLowerCase()];
        if (hit) resolved.set(pool.address, hit);
        else misses.push(pool);
      }
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

      // Pools the batch could not deliver, to be retried individually below.
      let outstanding = group;

      if (adapter.getRawDataBatch) {
        try {
          const rows = await adapter.getRawDataBatch(group);
          const missed: PoolInfo[] = [];
          group.forEach((pool, i) => {
            const rawData = rows[i];
            if (rawData) fetched.push({ pool, rawData });
            else missed.push(pool);
          });
          // A batch that came back partly empty means those particular pools
          // did not answer - a revert, or a provider trimming an oversized
          // multicall. Dropping them is how a token silently loses half its
          // sources while still answering, so they are retried one at a time.
          //
          // A batch that came back *entirely* empty means something else: the
          // call itself was refused. Retrying every pool separately then turns
          // one rejected request into `group.length` of them against a provider
          // that is already saying no, which is how a throttled read became a
          // forty-second one instead of a fast degraded answer.
          if (missed.length === group.length && group.length > 0) {
            console.warn(
              `Batch read for ${dex} returned nothing for all ${group.length} pools; not retrying individually`
            );
            continue;
          }
          if (missed.length > 0) {
            console.warn(
              `Batch read for ${dex} returned ${missed.length}/${group.length} empty; retrying individually`
            );
          }
          outstanding = missed;
        } catch (error) {
          // Fall through to per-pool reads rather than losing the whole DEX.
          console.error(`Batch read failed for ${dex}, falling back to per-pool:`, error);
        }
      }

      if (outstanding.length === 0) continue;

      const rows = await mapWithConcurrency(outstanding, RAW_DATA_CONCURRENCY, async pool => {
        try {
          return { pool, rawData: await adapter.getRawData(pool.address, pool) };
        } catch (error) {
          console.error('Error fetching raw data for a pool:', error);
          return null;
        }
      });
      for (const row of rows) if (row) fetched.push(row);
    }

    for (const { pool, rawData } of fetched) resolved.set(pool.address, rawData);

    // 3. Write the set back as a single entry, and only when something new was
    // actually read - rewriting an untouched set would spend a write to store
    // what is already there.
    if (this.cache && fetched.length > 0) {
      const payload: Record<string, RawPoolData> = {};
      for (const pool of pools) {
        const data = resolved.get(pool.address);
        if (data) payload[pool.address.toLowerCase()] = data;
      }
      try {
        await this.cache.set(rawKey, payload, 60);
      } catch {
        // A cache write must never be the reason a priced token fails.
      }
    }

    // Preserve the caller's ordering.
    return pools
      .filter(pool => resolved.has(pool.address))
      .map(pool => ({ pool, rawData: resolved.get(pool.address)! }));
  }

}
