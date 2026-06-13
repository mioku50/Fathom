import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEXOrchestrator } from '../../src/orchestrator';
import { UniswapV2Adapter } from '../../src/adapters/uniswap_v2';
import { UniswapV3Adapter } from '../../src/adapters/uniswap_v3';
import { AerodromeAdapter } from '../../src/adapters/aerodrome';
import { DEXAdapter, PoolInfo, RawPoolData } from '../../src/dex_adapter';
import { MockDEXAdapter } from './mock_dex_adapter';


class MockCache {
  private store = new Map<string, any>();
  async get(key: string) { return this.store.get(key); }
  async set(key: string, value: any, ttl?: number) { this.store.set(key, value); }
}

describe('Pricing Engine Adapters Integration', () => {
  it('should use cache for getAllPools when provided', async () => {
    const uniV2 = new MockDEXAdapter('uniswap_v2');
    uniV2.setPools('0xWETH', [{ address: '0xuniswap_v2Pool', dex: 'uniswap_v2', fee: 0.003 }]);
    const cache = new MockCache();
    await cache.set('orchestrator:pools:0xweth', [{ address: '0xCachedPool', dex: 'cached_dex', fee: 0.01 }]);

    const orchestrator = new DEXOrchestrator([uniV2], cache);
    const pools = await orchestrator.getAllPools('0xWETH');

    expect(pools).toHaveLength(1);
    expect(pools[0].address).toBe('0xCachedPool');
    expect(pools[0].dex).toBe('cached_dex');
  });

  it('should cache results from getAllPools', async () => {
    const uniV2 = new MockDEXAdapter('uniswap_v2');
    uniV2.setPools('0xWETH', [{ address: '0xuniswap_v2Pool', dex: 'uniswap_v2', fee: 0.003 }]);
    const cache = new MockCache();

    const orchestrator = new DEXOrchestrator([uniV2], cache);
    const pools = await orchestrator.getAllPools('0xWETH');

    expect(pools).toHaveLength(1);

    const cached = await cache.get('orchestrator:pools:0xweth');
    expect(cached).toHaveLength(1);
    expect(cached[0].address).toBe('0xuniswap_v2Pool');
  });

  it('should use cache for getAllRawData when provided', async () => {
    const uniV2 = new MockDEXAdapter('uniswap_v2');
    const cache = new MockCache();
    await cache.set('orchestrator:raw:0xpool', { reserve0: 500n, reserve1: 1000n, updatedAt: 123 });

    const orchestrator = new DEXOrchestrator([uniV2], cache);
    const testPools: PoolInfo[] = [{ address: '0xpool', dex: 'uniswap_v2', fee: 0.003 }];
    const data = await orchestrator.getAllRawData(testPools);

    expect(data).toHaveLength(1);
    expect(data[0].rawData.reserve0).toBe(500n);
  });

  it('should handle missing adapter in getAllRawData', async () => {
    const uniV2 = new MockDEXAdapter('uniswap_v2');
    uniV2.setRawData('0xValidPool', { reserve0: 100n, reserve1: 200n, updatedAt: 123456 });

    const orchestrator = new DEXOrchestrator([uniV2]);
    const testPools: PoolInfo[] = [
      { address: '0xValidPool', dex: 'uniswap_v2', fee: 0.003 },
      { address: '0xMissingAdapterPool', dex: 'missing_dex', fee: 0.003 }
    ];

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const rawDataResults = await orchestrator.getAllRawData(testPools);

    expect(rawDataResults).toHaveLength(1);
    expect(rawDataResults[0].pool.dex).toBe('uniswap_v2');
    expect(consoleWarnSpy).toHaveBeenCalledWith('No adapter found for DEX: missing_dex');
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should instantiate all supported adapters and use them in Orchestrator', async () => {
    // Note: in a real environment these need an RPC url or mock public client,
    // but the Orchestrator doesn't care, it just calls their interfaces.
    // For this test we will just verify the Orchestrator handles multiple adapters correctly.
    const uniV2 = new MockDEXAdapter('uniswap_v2');
    uniV2.setPools('0xWETH', [{ address: '0xuniswap_v2Pool', dex: 'uniswap_v2', fee: 0.003 }]);
    const uniV3 = new MockDEXAdapter('uniswap_v3');
    uniV3.setPools('0xWETH', [{ address: '0xuniswap_v3Pool', dex: 'uniswap_v3', fee: 0.003 }]);
    const aero = new MockDEXAdapter('aerodrome');
    aero.setPools('0xWETH', [{ address: '0xaerodromePool', dex: 'aerodrome', fee: 0.003 }]);

    const adapters = [uniV2, uniV3, aero];

    const orchestrator = new DEXOrchestrator(adapters);

    const pools = await orchestrator.getAllPools('0xWETH');

    expect(pools).toHaveLength(3);
    expect(pools.map(p => p.dex)).toEqual(expect.arrayContaining(['uniswap_v2', 'uniswap_v3', 'aerodrome']));
  });

  it('orchestrator should gracefully handle one adapter failing to discover pools', async () => {
    const failingAdapter = new MockDEXAdapter('failing');
    vi.spyOn(failingAdapter, 'getPools').mockRejectedValue(new Error('RPC limit exceeded'));

    const uniV2 = new MockDEXAdapter('uniswap_v2');
    uniV2.setPools('0xWETH', [{ address: '0xuniswap_v2Pool', dex: 'uniswap_v2', fee: 0.003 }]);
    const aero = new MockDEXAdapter('aerodrome');
    aero.setPools('0xWETH', [{ address: '0xaerodromePool', dex: 'aerodrome', fee: 0.003 }]);

    const adapters = [
      uniV2,
      failingAdapter,
      aero
    ];

    const orchestrator = new DEXOrchestrator(adapters);

    // Suppress console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pools = await orchestrator.getAllPools('0xWETH');

    // Should still return pools from the 2 working adapters
    expect(pools).toHaveLength(2);
    expect(pools.map(p => p.dex)).toEqual(['uniswap_v2', 'aerodrome']);

    consoleSpy.mockRestore();
  });

  it('orchestrator should gracefully handle one adapter failing to fetch raw data', async () => {
    const uniV2 = new MockDEXAdapter('uniswap_v2');
    uniV2.setRawData('0xValidPool', { reserve0: 100n, reserve1: 200n, updatedAt: 123456 });
    const aero = new MockDEXAdapter('aerodrome');
    aero.setRawData('0xErrorPool', new Error('Simulated error in aerodrome'));

    const adapters = [
      uniV2,
      aero
    ];

    const orchestrator = new DEXOrchestrator(adapters);

    const testPools: PoolInfo[] = [
      { address: '0xValidPool', dex: 'uniswap_v2', fee: 0.003 },
      { address: '0xErrorPool', dex: 'aerodrome', fee: 0.003 }
    ];

    // Suppress console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const rawDataResults = await orchestrator.getAllRawData(testPools);

    // Should only contain the successfully fetched data
    expect(rawDataResults).toHaveLength(1);
    expect(rawDataResults[0].pool.dex).toBe('uniswap_v2');
    expect(rawDataResults[0].rawData.reserve0).toBe(100n);

    consoleSpy.mockRestore();
  });
});

describe('Real Adapters Error Handling', () => {
  it('DEXOrchestrator should fall back to secondary adapters when primary fails', async () => {
    // Primary adapter (failing)
    const uniV2 = new MockDEXAdapter('uniswap_v2');
    vi.spyOn(uniV2, 'getPools').mockRejectedValue(new Error('RPC rate limit exceeded'));

    // Secondary adapters (working)
    const uniV3 = new MockDEXAdapter('uniswap_v3');
    uniV3.setPools('0xWETH', [{ address: '0xuniswap_v3Pool', dex: 'uniswap_v3', fee: 0.003 }]);

    const aero = new MockDEXAdapter('aerodrome');
    aero.setPools('0xWETH', [{ address: '0xaerodromePool', dex: 'aerodrome', fee: 0.003 }]);

    const orchestrator = new DEXOrchestrator([uniV2, uniV3, aero]);

    // Suppress expected console errors from the failing adapter
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pools = await orchestrator.getAllPools('0xWETH');

    // Should successfully retrieve pools from secondary adapters
    expect(pools).toHaveLength(2);
    expect(pools.map(p => p.dex)).toEqual(expect.arrayContaining(['uniswap_v3', 'aerodrome']));

    // Error should have been logged for the failing primary adapter
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching pools from an adapter:', expect.any(Error));

    consoleErrorSpy.mockRestore();
  });

  it('UniswapV2Adapter should handle 429 errors and generic errors correctly', async () => {
    const adapter = new UniswapV2Adapter('http://localhost:8545');
    const mockClient = { readContract: vi.fn() };
    (adapter as any).client = mockClient;

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // getPools rate limit
    mockClient.readContract.mockRejectedValueOnce(new Error('RPC rate limit exceeded (429)'));
    await expect(adapter.getPools('0xWETH')).rejects.toThrow('RPC rate limit exceeded');

    // getPools generic error
    mockClient.readContract.mockRejectedValueOnce(new Error('Contract reverted'));
    const pools = await adapter.getPools('0xWETH');
    expect(pools).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();

    // getRawData rate limit
    mockClient.readContract.mockRejectedValueOnce(new Error('Returned 429'));
    await expect(adapter.getRawData('0xPool')).rejects.toThrow('RPC rate limit exceeded');

    // getRawData generic error
    mockClient.readContract.mockRejectedValueOnce(new Error('Contract reverted'));
    await expect(adapter.getRawData('0xPool')).rejects.toThrow('Failed to fetch raw data');

    consoleErrorSpy.mockRestore();
  });

  it('UniswapV3Adapter should handle 429 errors and generic errors correctly', async () => {
    const adapter = new UniswapV3Adapter('http://localhost:8545');
    const mockClient = { readContract: vi.fn() };
    (adapter as any).client = mockClient;

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // getPools rate limit
    mockClient.readContract.mockRejectedValueOnce(new Error('RPC rate limit exceeded (429)'));
    await expect(adapter.getPools('0xWETH')).rejects.toThrow('RPC rate limit exceeded');

    // getPools generic error
    mockClient.readContract.mockRejectedValueOnce(new Error('Contract reverted'));
    const pools = await adapter.getPools('0xWETH');
    expect(pools).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();

    // getRawData rate limit
    mockClient.readContract.mockRejectedValueOnce(new Error('Returned 429'));
    await expect(adapter.getRawData('0xPool')).rejects.toThrow('RPC rate limit exceeded');

    // getRawData generic error
    mockClient.readContract.mockRejectedValueOnce(new Error('Contract reverted'));
    await expect(adapter.getRawData('0xPool')).rejects.toThrow('Failed to fetch raw data');

    consoleErrorSpy.mockRestore();
  });

  it('AerodromeAdapter should handle generic errors correctly', async () => {
    const adapter = new AerodromeAdapter('http://localhost:8545');
    const mockClient = { readContract: vi.fn() };
    (adapter as any).client = mockClient;

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // getPools generic error
    mockClient.readContract.mockRejectedValueOnce(new Error('Contract reverted'));
    const pools = await adapter.getPools('0xWETH');
    expect(pools).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();

    // getRawData generic error
    mockClient.readContract.mockRejectedValueOnce(new Error('Contract reverted'));
    await expect(adapter.getRawData('0xPool')).rejects.toThrow('Failed to fetch raw data');

    consoleErrorSpy.mockRestore();
  });
});
