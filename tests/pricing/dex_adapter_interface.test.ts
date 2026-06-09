import { describe, it, expect } from 'vitest';
import { DEXAdapter, PoolInfo, RawPoolData } from '../../src/dex_adapter';

class ExtendedMockDEXAdapter implements DEXAdapter {
  readonly id = 'mock_extended';

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    if (tokenAddress === '0xvalid') {
      return [
        { address: '0xpool1', dex: 'mock_extended', fee: 0.003 }
      ];
    }
    return [];
  }

  async getRawData(poolAddress: string): Promise<RawPoolData> {
    if (poolAddress === '0xpool1') {
      return {
        reserve0: 1000n,
        reserve1: 2000n,
        liquidity: 3000n,
        sqrtPriceX96: 4000n,
        tick: 100,
        updatedAt: 1234567890
      };
    }
    return {
      updatedAt: 0
    };
  }
}

describe('DEXAdapter Interface Extended', () => {
  it('should verify the structure of PoolInfo', async () => {
    const adapter: DEXAdapter = new ExtendedMockDEXAdapter();

    const pools = await adapter.getPools('0xvalid');
    expect(pools.length).toBe(1);

    const pool = pools[0];
    expect(pool).toHaveProperty('address', '0xpool1');
    expect(pool).toHaveProperty('dex', 'mock_extended');
    expect(pool).toHaveProperty('fee', 0.003);
  });

  it('should verify the extended structure of RawPoolData', async () => {
    const adapter: DEXAdapter = new ExtendedMockDEXAdapter();

    const rawData = await adapter.getRawData('0xpool1');

    expect(rawData).toHaveProperty('reserve0', 1000n);
    expect(rawData).toHaveProperty('reserve1', 2000n);
    expect(rawData).toHaveProperty('liquidity', 3000n);
    expect(rawData).toHaveProperty('sqrtPriceX96', 4000n);
    expect(rawData).toHaveProperty('tick', 100);
    expect(rawData).toHaveProperty('updatedAt', 1234567890);
  });
});
