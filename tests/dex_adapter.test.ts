import { describe, it, expect } from 'vitest';
import { DEXAdapter, PoolInfo, RawPoolData } from '../src/dex_adapter';

class MockDEXAdapter implements DEXAdapter {
  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    if (tokenAddress === '0x123') {
      return [
        { address: '0xabc', dex: 'mock_dex', fee: 0.003 }
      ];
    }
    return [];
  }

  async getRawData(poolAddress: string): Promise<RawPoolData> {
    if (poolAddress === '0xabc') {
      return {
        reserve0: 1000n,
        reserve1: 2000n,
        updatedAt: 1234567890
      };
    }
    return {
      updatedAt: 0
    };
  }
}

describe('DEXAdapter Interface', () => {
  it('should be implementable by a mock class', async () => {
    const adapter: DEXAdapter = new MockDEXAdapter();

    const pools = await adapter.getPools('0x123');
    expect(pools.length).toBe(1);
    expect(pools[0].address).toBe('0xabc');
    expect(pools[0].dex).toBe('mock_dex');
    expect(pools[0].fee).toBe(0.003);

    const emptyPools = await adapter.getPools('0x000');
    expect(emptyPools.length).toBe(0);

    const rawData = await adapter.getRawData('0xabc');
    expect(rawData.reserve0).toBe(1000n);
    expect(rawData.reserve1).toBe(2000n);
    expect(rawData.updatedAt).toBe(1234567890);
    expect(rawData.liquidity).toBeUndefined();
  });
});
