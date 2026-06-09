import { describe, it, expect, vi } from 'vitest';
import { DEXOrchestrator, CacheLayer } from '../../src/orchestrator';
import { DEXAdapter, PoolInfo, RawPoolData } from '../../src/dex_adapter';

class MockCacheLayer implements CacheLayer {
  private store = new Map<string, any>();

  async get(key: string): Promise<any> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    this.store.set(key, value);
  }

  // Test helper
  getStore() {
    return this.store;
  }
}

class MockAerodromeAdapter implements DEXAdapter {
  readonly id = 'aerodrome';

  public getPoolsCallCount = 0;
  public getRawDataCallCount = 0;

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    this.getPoolsCallCount++;
    return [
      { address: '0xA1', dex: 'aerodrome', fee: 0.003 }
    ];
  }
  async getRawData(poolAddress: string): Promise<RawPoolData> {
    this.getRawDataCallCount++;
    return { reserve0: 100n, reserve1: 200n, updatedAt: 12345 };
  }
}

describe('DEXOrchestrator Caching', () => {
  it('should fetch pools from adapter and set cache on first call', async () => {
    const cache = new MockCacheLayer();
    const adapter = new MockAerodromeAdapter();
    const orchestrator = new DEXOrchestrator([adapter], cache);

    const pools = await orchestrator.getAllPools('0xTOKEN');

    expect(pools.length).toBe(1);
    expect(adapter.getPoolsCallCount).toBe(1);

    const cachedPools = await cache.get('orchestrator:pools:0xtoken');
    expect(cachedPools).toBeDefined();
    expect(cachedPools.length).toBe(1);
    expect(cachedPools[0].address).toBe('0xA1');
  });

  it('should return pools from cache and skip adapter if available', async () => {
    const cache = new MockCacheLayer();
    const adapter = new MockAerodromeAdapter();
    const orchestrator = new DEXOrchestrator([adapter], cache);

    // Seed cache
    await cache.set('orchestrator:pools:0xtoken', [
      { address: '0xA2', dex: 'aerodrome', fee: 0.001 }
    ]);

    const pools = await orchestrator.getAllPools('0xTOKEN');

    expect(pools.length).toBe(1);
    expect(pools[0].address).toBe('0xA2');
    expect(adapter.getPoolsCallCount).toBe(0); // Adapter not called
  });

  it('should fetch raw data from adapter and set cache on first call', async () => {
    const cache = new MockCacheLayer();
    const adapter = new MockAerodromeAdapter();
    const orchestrator = new DEXOrchestrator([adapter], cache);

    const pools = [{ address: '0xA1', dex: 'aerodrome', fee: 0.003 }];
    const allData = await orchestrator.getAllRawData(pools);

    expect(allData.length).toBe(1);
    expect(adapter.getRawDataCallCount).toBe(1);

    const cachedData = await cache.get('orchestrator:raw:0xa1');
    expect(cachedData).toBeDefined();
    expect(cachedData.reserve0).toBe(100n);
  });

  it('should return raw data from cache and skip adapter if available', async () => {
    const cache = new MockCacheLayer();
    const adapter = new MockAerodromeAdapter();
    const orchestrator = new DEXOrchestrator([adapter], cache);

    // Seed cache
    await cache.set('orchestrator:raw:0xa1', { reserve0: 500n, reserve1: 1000n, updatedAt: 99999 });

    const pools = [{ address: '0xA1', dex: 'aerodrome', fee: 0.003 }];
    const allData = await orchestrator.getAllRawData(pools);

    expect(allData.length).toBe(1);
    expect(allData[0].rawData.reserve0).toBe(500n);
    expect(adapter.getRawDataCallCount).toBe(0); // Adapter not called
  });

  it('should handle partial cache hits for raw data (some cached, some not)', async () => {
    const cache = new MockCacheLayer();
    const adapter = new MockAerodromeAdapter();
    const orchestrator = new DEXOrchestrator([adapter], cache);

    // Seed cache for A2 only
    await cache.set('orchestrator:raw:0xa2', { reserve0: 500n, reserve1: 1000n, updatedAt: 99999 });

    const pools = [
      { address: '0xA1', dex: 'aerodrome', fee: 0.003 }, // Not cached
      { address: '0xA2', dex: 'aerodrome', fee: 0.001 }  // Cached
    ];

    const allData = await orchestrator.getAllRawData(pools);

    expect(allData.length).toBe(2);

    const a1Data = allData.find(d => d.pool.address === '0xA1');
    expect(a1Data!.rawData.reserve0).toBe(100n); // From adapter

    const a2Data = allData.find(d => d.pool.address === '0xA2');
    expect(a2Data!.rawData.reserve0).toBe(500n); // From cache

    expect(adapter.getRawDataCallCount).toBe(1); // Adapter called only once (for A1)
  });

  it('should properly handle concurrent requests before cache writes complete', async () => {
    // Modify the mock cache to have an artificial delay
    class DelayedCacheLayer extends MockCacheLayer {
      async get(key: string): Promise<any> {
        await new Promise(r => setTimeout(r, 10));
        return super.get(key);
      }
      async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
        await new Promise(r => setTimeout(r, 10));
        return super.set(key, value, ttlSeconds);
      }
    }

    class DelayedAdapter extends MockAerodromeAdapter {
      async getRawData(poolAddress: string): Promise<RawPoolData> {
        this.getRawDataCallCount++;
        await new Promise(r => setTimeout(r, 20));
        return { reserve0: 100n, reserve1: 200n, updatedAt: 12345 };
      }
    }

    const cache = new DelayedCacheLayer();
    const adapter = new DelayedAdapter();
    const orchestrator = new DEXOrchestrator([adapter], cache);

    const pools = [{ address: '0xA1', dex: 'aerodrome', fee: 0.003 }];

    // Fire 5 concurrent requests before any can populate the cache
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(orchestrator.getAllRawData(pools));
    }

    await Promise.all(promises);

    // Because there is no Promise deduping layer in the current orchestrator implementation,
    // all 5 concurrent requests will miss the cache simultaneously and call the adapter.
    expect(adapter.getRawDataCallCount).toBe(5);
  });

  it('should correctly hit cache limit rules (TTL) for pools and raw data', async () => {
    const cache = new MockCacheLayer();
    const adapter = new MockAerodromeAdapter();
    const orchestrator = new DEXOrchestrator([adapter], cache);

    const setSpy = vi.spyOn(cache, 'set');

    // 1. Fetch pools (should set TTL to 3600)
    await orchestrator.getAllPools('0xTOKEN_TTL');
    expect(setSpy).toHaveBeenCalledWith(
      'orchestrator:pools:0xtoken_ttl',
      expect.any(Array),
      3600
    );

    // 2. Fetch raw data (should set TTL to 60)
    const pools = [{ address: '0xA1_TTL', dex: 'aerodrome', fee: 0.003 }];
    await orchestrator.getAllRawData(pools);
    expect(setSpy).toHaveBeenCalledWith(
      'orchestrator:raw:0xa1_ttl',
      expect.any(Object),
      60
    );
  });
});
