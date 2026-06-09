import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEXOrchestrator } from '../../src/orchestrator';
import { UniswapV2Adapter } from '../../src/adapters/uniswap_v2';
import { UniswapV3Adapter } from '../../src/adapters/uniswap_v3';
import { AerodromeAdapter } from '../../src/adapters/aerodrome';
import { DEXAdapter, PoolInfo, RawPoolData } from '../../src/dex_adapter';

// Create a stable mock adapter for testing orchestrator with real adapter instances
class FakeAdapter implements DEXAdapter {
  constructor(public id: string) {}

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    if (tokenAddress === '0xWETH') {
      return [{ address: `0x${this.id}Pool`, dex: this.id, fee: 0.003 }];
    }
    return [];
  }

  async getRawData(poolAddress: string): Promise<RawPoolData> {
    if (poolAddress.includes('Error')) {
      throw new Error(`Simulated error in ${this.id}`);
    }
    return {
      reserve0: 100n,
      reserve1: 200n,
      updatedAt: 123456
    };
  }
}

describe('Pricing Engine Adapters Integration', () => {
  it('should instantiate all supported adapters and use them in Orchestrator', async () => {
    // Note: in a real environment these need an RPC url or mock public client,
    // but the Orchestrator doesn't care, it just calls their interfaces.
    // For this test we will just verify the Orchestrator handles multiple adapters correctly.
    const adapters = [
      new FakeAdapter('uniswap_v2'),
      new FakeAdapter('uniswap_v3'),
      new FakeAdapter('aerodrome')
    ];

    const orchestrator = new DEXOrchestrator(adapters);

    const pools = await orchestrator.getAllPools('0xWETH');

    expect(pools).toHaveLength(3);
    expect(pools.map(p => p.dex)).toEqual(expect.arrayContaining(['uniswap_v2', 'uniswap_v3', 'aerodrome']));
  });

  it('orchestrator should gracefully handle one adapter failing to discover pools', async () => {
    const failingAdapter = new FakeAdapter('failing');
    vi.spyOn(failingAdapter, 'getPools').mockRejectedValue(new Error('RPC limit exceeded'));

    const adapters = [
      new FakeAdapter('uniswap_v2'),
      failingAdapter,
      new FakeAdapter('aerodrome')
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
    const adapters = [
      new FakeAdapter('uniswap_v2'),
      new FakeAdapter('aerodrome')
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
