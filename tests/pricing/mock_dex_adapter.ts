import { DEXAdapter, PoolInfo, RawPoolData } from '../../src/dex_adapter';

export class MockDEXAdapter implements DEXAdapter {
  readonly id: string;
  private poolsMap: Map<string, PoolInfo[]> = new Map();
  private rawDataMap: Map<string, RawPoolData | Error> = new Map();

  constructor(id: string = 'mock_dex') {
    this.id = id;
  }

  setPools(tokenAddress: string, pools: PoolInfo[]): void {
    this.poolsMap.set(tokenAddress.toLowerCase(), pools);
  }

  setRawData(poolAddress: string, data: RawPoolData | Error): void {
    this.rawDataMap.set(poolAddress.toLowerCase(), data);
  }

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    return this.poolsMap.get(tokenAddress.toLowerCase()) || [];
  }

  async getRawData(poolAddress: string): Promise<RawPoolData> {
    const data = this.rawDataMap.get(poolAddress.toLowerCase());

    if (data === undefined) {
      throw new Error(`Raw data not found for pool ${poolAddress}`);
    }

    if (data instanceof Error) {
      throw data;
    }

    return data;
  }
}
