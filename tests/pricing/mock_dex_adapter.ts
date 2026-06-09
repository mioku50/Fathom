import { DEXAdapter, PoolInfo, RawPoolData } from '../../src/dex_adapter';

export interface Logger {
  log: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

export class MockDEXAdapter implements DEXAdapter {
  readonly id: string;
  private poolsMap: Map<string, PoolInfo[]> = new Map();
  private rawDataMap: Map<string, RawPoolData | Error> = new Map();
  private logger?: Logger | boolean;
  private delayMs: number = 0;
  private jitterMs: number = 0;
  public errorCount: number = 0;
  public getPoolsCallCount: number = 0;
  public getRawDataCallCount: number = 0;

  constructor(id: string = 'mock_dex', logger?: Logger | boolean) {
    this.id = id;
    this.logger = logger;
  }

  private doLog(level: 'info' | 'error', message: string, ...args: any[]): void {
    if (!this.logger) return;

    if (typeof this.logger === 'boolean') {
      if (level === 'info') {
        console.log(`[MockDEXAdapter:${this.id}] ${message}`, ...args);
      } else {
        console.error(`[MockDEXAdapter:${this.id}] ${message}`, ...args);
      }
    } else {
      if (level === 'info' && this.logger.log) {
        this.logger.log(message, ...args);
      } else if (level === 'error' && this.logger.error) {
        this.logger.error(message, ...args);
      } else if (level === 'error' && this.logger.log) { // fallback
        this.logger.log(message, ...args);
      }
    }
  }

  setPools(tokenAddress: string, pools: PoolInfo[]): void {
    this.poolsMap.set(tokenAddress.toLowerCase(), pools);
  }

  setRawData(poolAddress: string, data: RawPoolData | Error): void {
    this.rawDataMap.set(poolAddress.toLowerCase(), data);
  }

  setDelay(delayMs: number, jitterMs: number = 0): void {
    this.delayMs = delayMs;
    this.jitterMs = jitterMs;
  }

  private async simulateDelay(): Promise<void> {
    if (this.delayMs <= 0) return;

    let actualDelay = this.delayMs;
    if (this.jitterMs > 0) {
      const jitterOffset = Math.random() * (this.jitterMs * 2) - this.jitterMs;
      actualDelay += jitterOffset;
    }

    actualDelay = Math.max(0, actualDelay);

    if (actualDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, actualDelay));
    }
  }

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    this.getPoolsCallCount++;
    this.doLog('info', `getPools called for token: ${tokenAddress}`);
    const pools = this.poolsMap.get(tokenAddress.toLowerCase()) || [];
    await this.simulateDelay();
    this.doLog('info', `getPools returned for token: ${tokenAddress}`, pools);
    return pools;
  }

  resetErrorCount(): void {
    this.errorCount = 0;
  }

  reset(): void {
    this.poolsMap.clear();
    this.rawDataMap.clear();
    this.errorCount = 0;
    this.getPoolsCallCount = 0;
    this.getRawDataCallCount = 0;
  }

  async getRawData(poolAddress: string): Promise<RawPoolData> {
    this.getRawDataCallCount++;
    this.doLog('info', `getRawData called for pool: ${poolAddress}`);
    const data = this.rawDataMap.get(poolAddress.toLowerCase());

    await this.simulateDelay();

    if (data === undefined) {
      const error = new Error(`Raw data not found for pool ${poolAddress}`);
      this.doLog('error', `getRawData threw error for pool: ${poolAddress}`, error);
      this.errorCount++;
      throw error;
    }

    if (data instanceof Error) {
      this.doLog('error', `getRawData threw error for pool: ${poolAddress}`, data);
      this.errorCount++;
      throw data;
    }

    this.doLog('info', `getRawData returned for pool: ${poolAddress}`, data);
    return data;
  }
}
