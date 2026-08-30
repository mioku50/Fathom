import { UniswapV3Adapter } from '../src/adapters/uniswap_v3';
import { describe, it, expect, vi } from 'vitest';
import { DEXOrchestrator } from '../src/orchestrator';
import { DEXAdapter, PoolInfo, RawPoolData } from '../src/dex_adapter';

// Mock adapters
class MockAerodromeAdapter implements DEXAdapter {
  readonly id = 'aerodrome';

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    return [
      { address: '0xA1', dex: 'aerodrome', fee: 0.003 },
      { address: '0xA2', dex: 'aerodrome', fee: 0.0005 }
    ];
  }
  async getRawData(poolAddress: string): Promise<RawPoolData> {
    if (poolAddress === '0xA1') {
      return { reserve0: 100n, reserve1: 200n, updatedAt: 12345 };
    }
    throw new Error('Aerodrome raw data error');
  }
}

class MockUniswapV3Adapter implements DEXAdapter {
  readonly id = 'uniswap_v3';

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    return [
      { address: '0xU1', dex: 'uniswap_v3', fee: 0.003 }
    ];
  }
  async getRawData(poolAddress: string): Promise<RawPoolData> {
    return { sqrtPriceX96: 123456789n, tick: 100, liquidity: 1000n, updatedAt: 12345 };
  }
}

class MockFailingAdapter implements DEXAdapter {
  readonly id = 'failing_adapter';

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    throw new Error('Rate limit exceeded');
  }
  async getRawData(poolAddress: string): Promise<RawPoolData> {
    throw new Error('Rate limit exceeded');
  }
}

describe('DEXOrchestrator', () => {
  it('should aggregate pools from multiple adapters concurrently', async () => {
    const orchestrator = new DEXOrchestrator([
      new MockAerodromeAdapter(),
      new MockUniswapV3Adapter()
    ]);

    const pools = await orchestrator.getAllPools('0xTOKEN');
    expect(pools.length).toBe(3);
    expect(pools).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '0xA1', dex: 'aerodrome' }),
      expect.objectContaining({ address: '0xA2', dex: 'aerodrome' }),
      expect.objectContaining({ address: '0xU1', dex: 'uniswap_v3' })
    ]));
  });

  it('should handle failures from one adapter gracefully when getting pools', async () => {
    const orchestrator = new DEXOrchestrator([
      new MockAerodromeAdapter(),
      new MockFailingAdapter()
    ]);

    // Supress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pools = await orchestrator.getAllPools('0xTOKEN');
    expect(pools.length).toBe(2);
    expect(pools).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '0xA1', dex: 'aerodrome' }),
      expect.objectContaining({ address: '0xA2', dex: 'aerodrome' })
    ]));

    consoleSpy.mockRestore();
  });

  it('should aggregate raw data from multiple pools concurrently', async () => {
    const orchestrator = new DEXOrchestrator([
      new MockAerodromeAdapter(),
      new MockUniswapV3Adapter()
    ]);

    const pools: PoolInfo[] = [
      { address: '0xA1', dex: 'aerodrome', fee: 0.003 },
      { address: '0xU1', dex: 'uniswap_v3', fee: 0.003 }
    ];

    const allData = await orchestrator.getAllRawData(pools);
    expect(allData.length).toBe(2);

    // Find the A1 data
    const a1Data = allData.find(d => d.pool.address === '0xA1');
    expect(a1Data).toBeDefined();
    expect(a1Data!.rawData.reserve0).toBe(100n);

    // Find the U1 data
    const u1Data = allData.find(d => d.pool.address === '0xU1');
    expect(u1Data).toBeDefined();
    expect(u1Data!.rawData.liquidity).toBe(1000n);
  });

  it('should handle failures from individual pools gracefully when getting raw data', async () => {
    const orchestrator = new DEXOrchestrator([
      new MockAerodromeAdapter(),
      new MockUniswapV3Adapter()
    ]);

    const pools: PoolInfo[] = [
      { address: '0xA1', dex: 'aerodrome', fee: 0.003 },
      { address: '0xA2', dex: 'aerodrome', fee: 0.0005 }, // This one throws in mock
      { address: '0xU1', dex: 'uniswap_v3', fee: 0.003 }
    ];

    // Supress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const allData = await orchestrator.getAllRawData(pools);

    // Only A1 and U1 should succeed
    expect(allData.length).toBe(2);
    expect(allData.find(d => d.pool.address === '0xA1')).toBeDefined();
    expect(allData.find(d => d.pool.address === '0xU1')).toBeDefined();
    expect(allData.find(d => d.pool.address === '0xA2')).toBeUndefined();

    consoleSpy.mockRestore();
  });

  it('should warn when no adapter is found for a DEX', async () => {
    const orchestrator = new DEXOrchestrator([
      new MockAerodromeAdapter()
    ]);

    const pools: PoolInfo[] = [
      { address: '0xUNKNOWN', dex: 'unknown_dex', fee: 0.003 }
    ];

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const allData = await orchestrator.getAllRawData(pools);
    expect(allData.length).toBe(0);
    expect(consoleWarnSpy).toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should handle RPC rate limit errors from viem client gracefully', async () => {
    const uniswapAdapter = new UniswapV3Adapter('http://localhost:8545');
    (uniswapAdapter as any).client = {
      readContract: vi.fn().mockRejectedValue(new Error('HTTP request failed with status 429: Rate limit exceeded'))
    };

    const orchestrator = new DEXOrchestrator([
      new MockAerodromeAdapter(),
      uniswapAdapter
    ]);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // getPools should not crash and should return pools from MockAerodromeAdapter
    const pools = await orchestrator.getAllPools('0xTOKEN');
    expect(pools.length).toBe(2);
    expect(pools).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '0xA1', dex: 'aerodrome' }),
      expect.objectContaining({ address: '0xA2', dex: 'aerodrome' })
    ]));

    // getAllRawData should not crash
    const poolToFetch = [
      { address: '0xA1', dex: 'aerodrome', fee: 0.003 },
      { address: '0xU1', dex: 'uniswap_v3', fee: 0.003 }
    ];

    const allData = await orchestrator.getAllRawData(poolToFetch);
    expect(allData.length).toBe(1);
    expect(allData[0].pool.address).toBe('0xA1');

    consoleSpy.mockRestore();
  });

  it('should handle case where all adapters fail in getAllPools', async () => {
    const orchestrator = new DEXOrchestrator([
      new MockFailingAdapter(),
      new MockFailingAdapter()
    ]);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pools = await orchestrator.getAllPools('0xTOKEN');
    expect(pools.length).toBe(0);

    consoleSpy.mockRestore();
  });

  it('should handle case where all pools fail in getAllRawData', async () => {
    const orchestrator = new DEXOrchestrator([
      new MockFailingAdapter()
    ]);

    const pools: PoolInfo[] = [
      { address: '0xF1', dex: 'failing_adapter', fee: 0.003 },
      { address: '0xF2', dex: 'failing_adapter', fee: 0.003 }
    ];

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const allData = await orchestrator.getAllRawData(pools);
    expect(allData.length).toBe(0);

    consoleSpy.mockRestore();
  });

  it('should handle empty adapters array gracefully in getAllPools', async () => {
    const orchestrator = new DEXOrchestrator([]);

    const pools = await orchestrator.getAllPools('0xTOKEN');
    expect(pools.length).toBe(0);
  });

  it('should handle empty adapters array gracefully in getAllRawData', async () => {
    const orchestrator = new DEXOrchestrator([]);

    const pools: PoolInfo[] = [
      { address: '0xA1', dex: 'aerodrome', fee: 0.003 }
    ];

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const allData = await orchestrator.getAllRawData(pools);
    expect(allData.length).toBe(0);

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

describe('DEXOrchestrator read concurrency', () => {
  it('bounds how many pools are read at once', async () => {
    let inFlight = 0;
    let peak = 0;

    const adapter = {
      id: 'test_dex',
      getPools: vi.fn(async () => []),
      getRawData: vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 2));
        inFlight--;
        return { reserve0: 1n, reserve1: 2n, updatedAt: 1 };
      })
    } as any;

    const orchestrator = new DEXOrchestrator([adapter]);
    const pools = Array.from({ length: 30 }, (_, i) => ({ address: `0x${i}`, dex: 'test_dex' }));

    const data = await orchestrator.getAllRawData(pools);

    // A well-covered token can sit in 30+ pools; firing them all at once is what
    // got them rate-limited into looking like "no liquidity".
    expect(data).toHaveLength(30);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('keeps the readable pools when some fail', async () => {
    const adapter = {
      id: 'test_dex',
      getPools: vi.fn(async () => []),
      getRawData: vi.fn(async (address: string) => {
        if (address.endsWith('bad')) throw new Error('rate limit exceeded');
        return { reserve0: 1n, reserve1: 2n, updatedAt: 1 };
      })
    } as any;

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await new DEXOrchestrator([adapter]).getAllRawData([
      { address: '0xgood1', dex: 'test_dex' },
      { address: '0xbad', dex: 'test_dex' },
      { address: '0xgood2', dex: 'test_dex' }
    ]);
    spy.mockRestore();

    expect(data.map(d => d.pool.address)).toEqual(['0xgood1', '0xgood2']);
  });
});

describe('DEXOrchestrator batched reads', () => {
  it('reads all pools of one DEX in a single call', async () => {
    const getRawDataBatch = vi.fn(async (pools: any[]) =>
      pools.map(() => ({ reserve0: 1n, reserve1: 2n, updatedAt: 1 }))
    );
    const adapter = { id: 'batchy', getPools: vi.fn(), getRawData: vi.fn(), getRawDataBatch } as any;

    const pools = Array.from({ length: 25 }, (_, i) => ({ address: `0x${i}`, dex: 'batchy' }));
    const data = await new DEXOrchestrator([adapter]).getAllRawData(pools);

    expect(data).toHaveLength(25);
    // 25 pools, one round trip - not 25
    expect(getRawDataBatch).toHaveBeenCalledTimes(1);
    expect(adapter.getRawData).not.toHaveBeenCalled();
  });

  it('groups by DEX so each adapter is asked once', async () => {
    const make = (id: string) => ({
      id,
      getPools: vi.fn(),
      getRawData: vi.fn(),
      getRawDataBatch: vi.fn(async (pools: any[]) => pools.map(() => ({ reserve0: 1n, reserve1: 2n, updatedAt: 1 })))
    }) as any;
    const a = make('dex_a');
    const b = make('dex_b');

    await new DEXOrchestrator([a, b]).getAllRawData([
      { address: '0x1', dex: 'dex_a' }, { address: '0x2', dex: 'dex_b' },
      { address: '0x3', dex: 'dex_a' }, { address: '0x4', dex: 'dex_b' }
    ]);

    expect(a.getRawDataBatch).toHaveBeenCalledTimes(1);
    expect(a.getRawDataBatch.mock.calls[0][0]).toHaveLength(2);
    expect(b.getRawDataBatch).toHaveBeenCalledTimes(1);
  });

  it('retries individually the pools a batch came back empty on', async () => {
    const adapter = {
      id: 'batchy',
      getPools: vi.fn(),
      getRawData: vi.fn(async () => ({ reserve0: 3n, reserve1: 4n, updatedAt: 2 })),
      getRawDataBatch: vi.fn(async (pools: any[]) =>
        pools.map(p => p.address === '0xgap' ? null : { reserve0: 1n, reserve1: 2n, updatedAt: 1 })
      )
    } as any;

    const data = await new DEXOrchestrator([adapter]).getAllRawData([
      { address: '0xgood1', dex: 'batchy' },
      { address: '0xgap', dex: 'batchy' },
      { address: '0xgood2', dex: 'batchy' }
    ]);

    // A gap in a batch means "this one read did not land", not "this pool has
    // nothing". Accepting the gap is how a token quietly loses half its sources
    // while still answering confidently, so the gap is retried on its own.
    expect(data.map(d => d.pool.address)).toEqual(['0xgood1', '0xgap', '0xgood2']);
    expect(adapter.getRawData).toHaveBeenCalledTimes(1);
    expect(adapter.getRawData.mock.calls[0][0]).toBe('0xgap');
  });

  it('does not retry pool by pool when the whole batch came back empty', async () => {
    const adapter = {
      id: 'batchy',
      getPools: vi.fn(),
      getRawData: vi.fn(async () => ({ reserve0: 3n, reserve1: 4n, updatedAt: 2 })),
      getRawDataBatch: vi.fn(async (pools: any[]) => pools.map(() => null))
    } as any;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = await new DEXOrchestrator([adapter]).getAllRawData([
      { address: '0xa', dex: 'batchy' },
      { address: '0xb', dex: 'batchy' },
      { address: '0xc', dex: 'batchy' }
    ]);
    warnSpy.mockRestore();

    // Nothing came back at all, which means the call was refused rather than
    // that three particular pools reverted. Retrying each one turns a single
    // rejected request into three against a provider already saying no.
    expect(adapter.getRawData).not.toHaveBeenCalled();
    expect(data).toHaveLength(0);
  });

  it('drops a pool only once the individual retry has also failed', async () => {
    const adapter = {
      id: 'batchy',
      getPools: vi.fn(),
      getRawData: vi.fn(async () => { throw new Error('still unreadable'); }),
      getRawDataBatch: vi.fn(async (pools: any[]) =>
        pools.map(p => p.address === '0xbad' ? null : { reserve0: 1n, reserve1: 2n, updatedAt: 1 })
      )
    } as any;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = await new DEXOrchestrator([adapter]).getAllRawData([
      { address: '0xgood1', dex: 'batchy' },
      { address: '0xbad', dex: 'batchy' },
      { address: '0xgood2', dex: 'batchy' }
    ]);
    consoleSpy.mockRestore();
    warnSpy.mockRestore();

    expect(data.map(d => d.pool.address)).toEqual(['0xgood1', '0xgood2']);
  });

  it('does not retry when the batch answered for every pool', async () => {
    const adapter = {
      id: 'batchy',
      getPools: vi.fn(),
      getRawData: vi.fn(),
      getRawDataBatch: vi.fn(async (pools: any[]) =>
        pools.map(() => ({ reserve0: 1n, reserve1: 2n, updatedAt: 1 }))
      )
    } as any;

    await new DEXOrchestrator([adapter]).getAllRawData([
      { address: '0xa', dex: 'batchy' },
      { address: '0xb', dex: 'batchy' }
    ]);

    expect(adapter.getRawData).not.toHaveBeenCalled();
  });

  it('falls back to per-pool reads rather than losing a whole DEX', async () => {
    const adapter = {
      id: 'batchy',
      getPools: vi.fn(),
      getRawDataBatch: vi.fn(async () => { throw new Error('batch too large'); }),
      getRawData: vi.fn(async () => ({ reserve0: 1n, reserve1: 2n, updatedAt: 1 }))
    } as any;

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await new DEXOrchestrator([adapter]).getAllRawData([
      { address: '0x1', dex: 'batchy' }, { address: '0x2', dex: 'batchy' }
    ]);
    spy.mockRestore();

    expect(data).toHaveLength(2);
    expect(adapter.getRawData).toHaveBeenCalledTimes(2);
  });

  it('preserves the order it was given', async () => {
    const adapter = {
      id: 'batchy', getPools: vi.fn(), getRawData: vi.fn(),
      getRawDataBatch: vi.fn(async (pools: any[]) => pools.map(() => ({ reserve0: 1n, reserve1: 2n, updatedAt: 1 })))
    } as any;
    const b = {
      id: 'other', getPools: vi.fn(), getRawData: vi.fn(),
      getRawDataBatch: vi.fn(async (pools: any[]) => pools.map(() => ({ reserve0: 3n, reserve1: 4n, updatedAt: 1 })))
    } as any;

    const input = [
      { address: '0x1', dex: 'batchy' }, { address: '0x2', dex: 'other' },
      { address: '0x3', dex: 'batchy' }
    ];
    const data = await new DEXOrchestrator([adapter, b]).getAllRawData(input);

    expect(data.map(d => d.pool.address)).toEqual(['0x1', '0x2', '0x3']);
  });
});

describe('raw-pool cache cost', () => {
  const makeCache = () => {
    const store = new Map<string, any>();
    return {
      store,
      reads: [] as string[],
      writes: [] as string[],
      async get(k: string) {
        this.reads.push(k);
        return store.has(k) ? store.get(k) : null;
      },
      async set(k: string, v: any) {
        this.writes.push(k);
        store.set(k, v);
      }
    };
  };

  const manyPools = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      address: '0x' + String(i).padStart(40, '0'),
      dex: 'batchy'
    }));

  const adapter = () =>
    ({
      id: 'batchy',
      getPools: vi.fn(),
      getRawData: vi.fn(),
      getRawDataBatch: vi.fn(async (pools: any[]) =>
        pools.map(() => ({ reserve0: 1n, reserve1: 2n, updatedAt: 1 }))
      )
    }) as any;

  it('costs one read and one write regardless of how many pools a token has', async () => {
    // Per-pool keys cost 33 writes for a token like WETH, against a free-tier
    // allowance of 1,000 a day. The set is deterministic, so it needs one entry.
    const cache = makeCache();
    const pools = manyPools(33);

    await new DEXOrchestrator([adapter()], cache).getAllRawData(pools);

    expect(cache.reads).toHaveLength(1);
    expect(cache.writes).toHaveLength(1);
  });

  it('serves the whole set back from that one entry', async () => {
    const cache = makeCache();
    const pools = manyPools(33);
    const a = adapter();
    const orchestrator = new DEXOrchestrator([a], cache);

    await orchestrator.getAllRawData(pools);
    a.getRawDataBatch.mockClear();

    const second = await orchestrator.getAllRawData(pools);

    expect(a.getRawDataBatch).not.toHaveBeenCalled();
    expect(second).toHaveLength(33);
    expect(second[0].rawData.reserve0).toBe(1n);
  });

  it('does not spend a write when the cache already answered in full', async () => {
    const cache = makeCache();
    const pools = manyPools(5);
    const orchestrator = new DEXOrchestrator([adapter()], cache);

    await orchestrator.getAllRawData(pools);
    const writesAfterFirst = cache.writes.length;

    await orchestrator.getAllRawData(pools);

    expect(cache.writes).toHaveLength(writesAfterFirst);
  });

  it('keys on the set, so a different pool list does not collide', async () => {
    const cache = makeCache();
    const orchestrator = new DEXOrchestrator([adapter()], cache);

    await orchestrator.getAllRawData(manyPools(3));
    await orchestrator.getAllRawData(manyPools(4));

    expect(new Set(cache.writes).size).toBe(2);
  });

  it('keys on the set as a set, so ordering does not fragment the cache', async () => {
    const cache = makeCache();
    const pools = manyPools(4);
    const orchestrator = new DEXOrchestrator([adapter()], cache);

    await orchestrator.getAllRawData(pools);
    await orchestrator.getAllRawData([...pools].reverse());

    expect(new Set(cache.writes).size).toBe(1);
  });
});

describe('partial discovery', () => {
  const good = (id: string) =>
    ({ id, getPools: vi.fn(async () => [{ address: '0x' + id, dex: id }]), getRawData: vi.fn() }) as any;
  const broken = (id: string) =>
    ({ id, getPools: vi.fn(async () => { throw new Error('rate limit exceeded'); }), getRawData: vi.fn() }) as any;

  const makeCache = () => {
    const store = new Map<string, any>();
    const ttls: number[] = [];
    return {
      store,
      ttls,
      async get(k: string) { return store.has(k) ? store.get(k) : null; },
      async set(k: string, v: any, ttl?: number) { store.set(k, v); ttls.push(ttl ?? 0); }
    };
  };

  it('reports how many adapters failed', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const report = { adaptersTotal: 0, adaptersFailed: 0 };

    const pools = await new DEXOrchestrator([good('a'), broken('b'), broken('c')])
      .getAllPools('0xtoken', report);
    consoleSpy.mockRestore();

    expect(pools).toHaveLength(1);
    expect(report).toEqual({ adaptersTotal: 3, adaptersFailed: 2 });
  });

  it('uses pools from a backfilling adapter but reports partial coverage', async () => {
    const report = { adaptersTotal: 0, adaptersFailed: 0 };
    const partial = {
      id: 'v4',
      getPools: vi.fn(),
      getPoolsWithCoverage: vi.fn(async () => ({
        pools: [{ address: '0xpool', dex: 'v4' }],
        complete: false
      })),
      getRawData: vi.fn()
    } as any;

    const pools = await new DEXOrchestrator([partial]).getAllPools('0xtoken', report);
    expect(pools).toHaveLength(1);
    expect(report).toEqual({ adaptersTotal: 1, adaptersFailed: 1 });
  });

  it('does not freeze an impoverished pool list for an hour', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = makeCache();

    await new DEXOrchestrator([good('a'), broken('b')], cache).getAllPools('0xtoken');
    consoleSpy.mockRestore();

    // A token that trades on four venues must not look like a one-venue token
    // for the next hour because four adapters were throttled for one second.
    expect(cache.ttls).toEqual([60]);
  });

  it('still caches a complete discovery for an hour', async () => {
    const cache = makeCache();
    await new DEXOrchestrator([good('a'), good('b')], cache).getAllPools('0xtoken');
    expect(cache.ttls).toEqual([3600]);
  });

  it('reports a clean sweep as no failures', async () => {
    const report = { adaptersTotal: 0, adaptersFailed: 0 };
    await new DEXOrchestrator([good('a'), good('b')]).getAllPools('0xtoken', report);
    expect(report.adaptersFailed).toBe(0);
  });
});
