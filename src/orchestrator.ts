import { DEXAdapter, PoolInfo, RawPoolData } from './dex_adapter';

export interface PoolWithRawData {
  pool: PoolInfo;
  rawData: RawPoolData;
}

export class DEXOrchestrator {
  private adapters: DEXAdapter[];

  constructor(adapters: DEXAdapter[]) {
    this.adapters = adapters;
  }

  /**
   * Discovers all pools across all registered adapters concurrently.
   * @param tokenAddress The ERC-20 token contract address (0x...).
   * @returns A promise that resolves to an aggregated array of PoolInfo objects.
   */
  async getAllPools(tokenAddress: string): Promise<PoolInfo[]> {
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
      // Find the adapter responsible for this DEX
      const adapter = this.adapters.find(a => a.id === pool.dex);
      if (!adapter) {
         console.warn(`No adapter found for DEX: ${pool.dex}`);
         throw new Error(`No adapter found for DEX: ${pool.dex}`);
      }
      const rawData = await adapter.getRawData(pool.address);
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
