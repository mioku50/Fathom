import { DEXAdapter, PoolInfo, RawPoolData } from './dex_adapter';

export interface PoolWithRawData {
  pool: PoolInfo;
  rawData: RawPoolData;
}

export interface CacheLayer {
  get(key: string): Promise<any>;
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;
}

export class DEXOrchestrator {
  private adapters: DEXAdapter[];
  private cache?: CacheLayer;

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
   * Fetches raw data for a list of pools concurrently.
   * Gracefully handles failures for individual pools.
   * @param pools An array of PoolInfo objects to fetch data for.
   * @returns A promise that resolves to an array of objects containing both pool info and its raw data.
   */
  async getAllRawData(pools: PoolInfo[]): Promise<PoolWithRawData[]> {
    const promises = pools.map(async (pool) => {
      const cacheKey = `orchestrator:raw:${pool.address.toLowerCase()}`;
      if (this.cache) {
        const cachedRawData = await this.cache.get(cacheKey);
        if (cachedRawData) {
          return { pool, rawData: cachedRawData as RawPoolData };
        }
      }

      // Find the adapter responsible for this DEX
      const adapter = this.adapters.find(a => a.id === pool.dex);
      if (!adapter) {
         console.warn(`No adapter found for DEX: ${pool.dex}`);
         throw new Error(`No adapter found for DEX: ${pool.dex}`);
      }
      const rawData = await adapter.getRawData(pool.address);

      if (this.cache) {
        await this.cache.set(cacheKey, rawData, 60); // Cache for 60 seconds
      }

      return { pool, rawData };
    });

    const results = await Promise.allSettled(promises);

    const allData: PoolWithRawData[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allData.push(result.value);
      } else {
         console.error('Error fetching raw data for a pool:', result.reason);
      }
    }

    return allData;
  }
}
