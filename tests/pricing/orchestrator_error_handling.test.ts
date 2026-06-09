import { describe, it, expect, vi } from 'vitest';
import { DEXOrchestrator } from '../../src/orchestrator';
import { MockDEXAdapter } from './mock_dex_adapter';
import { PoolInfo } from '../../src/dex_adapter';

describe('DEXOrchestrator Error Handling', () => {
  it('should gracefully handle missing adapters during getAllRawData', async () => {
    const uniV2 = new MockDEXAdapter('uniswap_v2');
    uniV2.setRawData('0xValidPool', { reserve0: 100n, reserve1: 200n, updatedAt: 123456 });

    // We only provide the uniswap_v2 adapter
    const orchestrator = new DEXOrchestrator([uniV2]);

    const testPools: PoolInfo[] = [
      { address: '0xValidPool', dex: 'uniswap_v2', fee: 0.003 },
      { address: '0xMissingPool', dex: 'missing_dex', fee: 0.003 }
    ];

    // Suppress console.warn and console.error
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const rawDataResults = await orchestrator.getAllRawData(testPools);

    // Should only contain the successfully fetched data from the existing adapter
    expect(rawDataResults).toHaveLength(1);
    expect(rawDataResults[0].pool.dex).toBe('uniswap_v2');
    expect(rawDataResults[0].rawData.reserve0).toBe(100n);

    expect(warnSpy).toHaveBeenCalledWith('No adapter found for DEX: missing_dex');
    expect(errorSpy).toHaveBeenCalled(); // Logs the error when promise rejects

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should continue processing remaining adapters when one adapter fails in getAllPools', async () => {
    const failingAdapter = new MockDEXAdapter('failing');
    vi.spyOn(failingAdapter, 'getPools').mockRejectedValue(new Error('RPC limit exceeded'));

    const uniV2 = new MockDEXAdapter('uniswap_v2');
    uniV2.setPools('0xWETH', [{ address: '0xuniswap_v2Pool', dex: 'uniswap_v2', fee: 0.003 }]);

    const uniV3 = new MockDEXAdapter('uniswap_v3');
    uniV3.setPools('0xWETH', [{ address: '0xuniswap_v3Pool', dex: 'uniswap_v3', fee: 0.003 }]);

    const orchestrator = new DEXOrchestrator([failingAdapter, uniV2, uniV3]);

    // Suppress console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pools = await orchestrator.getAllPools('0xWETH');

    expect(pools).toHaveLength(2);
    expect(pools.map(p => p.dex)).toEqual(expect.arrayContaining(['uniswap_v2', 'uniswap_v3']));

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
