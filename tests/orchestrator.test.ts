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
    const uniswapAdapter = new UniswapV3Adapter();
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
