import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockDEXAdapter } from './mock_dex_adapter';
import { PoolInfo, RawPoolData } from '../../src/dex_adapter';

describe('MockDEXAdapter', () => {
  let adapter: MockDEXAdapter;

  beforeEach(() => {
    adapter = new MockDEXAdapter('test_mock');
  });

  it('should return configured pools for a token', async () => {
    const mockPools: PoolInfo[] = [
      { address: '0xpool1', dex: 'test_mock', fee: 0.003 }
    ];
    adapter.setPools('0xTokenA', mockPools);

    const pools = await adapter.getPools('0xTokenA');
    expect(pools).toEqual(mockPools);
  });

  it('should return an empty array if token is unconfigured', async () => {
    const pools = await adapter.getPools('0xUnknown');
    expect(pools).toEqual([]);
  });

  it('should return configured raw data for a pool', async () => {
    const mockData: RawPoolData = {
      reserve0: 1000n,
      reserve1: 2000n,
      updatedAt: 12345
    };
    adapter.setRawData('0xpool1', mockData);

    const data = await adapter.getRawData('0xpool1');
    expect(data).toEqual(mockData);
  });

  it('should throw an error if configured to throw an error', async () => {
    const error = new Error('Simulated RPC Error');
    adapter.setRawData('0xpool_error', error);

    await expect(adapter.getRawData('0xpool_error')).rejects.toThrow('Simulated RPC Error');
  });

  it('should throw an error if pool is unconfigured', async () => {
    await expect(adapter.getRawData('0xunknown_pool')).rejects.toThrow('Raw data not found for pool 0xunknown_pool');
  });

  it('should be case-insensitive for token and pool addresses', async () => {
    const mockPools: PoolInfo[] = [{ address: '0xPool1', dex: 'test_mock', fee: 0.003 }];
    adapter.setPools('0xTOKENa', mockPools);
    expect(await adapter.getPools('0xTokenA')).toEqual(mockPools);

    const mockData: RawPoolData = { reserve0: 10n, reserve1: 20n, updatedAt: 123 };
    adapter.setRawData('0xPoOl1', mockData);
    expect(await adapter.getRawData('0XpOOl1')).toEqual(mockData);
  });

  it('should handle simulated HTTP 429 Rate Limit error', async () => {
    const error = new Error('HTTP 429: Too Many Requests');
    (error as any).status = 429;
    adapter.setRawData('0xpool_429', error);

    await expect(adapter.getRawData('0xpool_429')).rejects.toThrow('HTTP 429: Too Many Requests');
  });

  it('should handle simulated RPC Timeout error', async () => {
    const error = new Error('RPC Timeout');
    (error as any).code = 'ETIMEDOUT';
    adapter.setRawData('0xpool_timeout', error);

    await expect(adapter.getRawData('0xpool_timeout')).rejects.toThrow('RPC Timeout');
  });

  it('should handle simulated Contract Revert error', async () => {
    const error = new Error('execution reverted: UniswapV2: INSUFFICIENT_LIQUIDITY');
    (error as any).code = 3;
    adapter.setRawData('0xpool_revert', error);

    await expect(adapter.getRawData('0xpool_revert')).rejects.toThrow('execution reverted: UniswapV2: INSUFFICIENT_LIQUIDITY');
  });
});

describe('MockDEXAdapter Logging', () => {
  it('should log when a boolean logger is provided', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const loggingAdapter = new MockDEXAdapter('test_log', true);
    loggingAdapter.setPools('0xTokenA', [{ address: '0xpool1', dex: 'test_log', fee: 0.003 }]);

    await loggingAdapter.getPools('0xTokenA');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[MockDEXAdapter:test_log] getPools called for token: 0xTokenA'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[MockDEXAdapter:test_log] getPools returned for token: 0xTokenA'), expect.any(Array));

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should use custom logger if provided', async () => {
    const customLogger = {
      log: vi.fn(),
      error: vi.fn()
    };

    const loggingAdapter = new MockDEXAdapter('test_custom', customLogger);
    loggingAdapter.setPools('0xTokenB', [{ address: '0xpool2', dex: 'test_custom', fee: 0.003 }]);

    await loggingAdapter.getPools('0xTokenB');

    expect(customLogger.log).toHaveBeenCalledWith('getPools called for token: 0xTokenB');
    expect(customLogger.log).toHaveBeenCalledWith('getPools returned for token: 0xTokenB', expect.any(Array));
  });

  it('should log errors appropriately', async () => {
    const customLogger = {
      log: vi.fn(),
      error: vi.fn()
    };

    const loggingAdapter = new MockDEXAdapter('test_custom_error', customLogger);
    const error = new Error('Simulated RPC Error');
    loggingAdapter.setRawData('0xpool_error', error);

    await expect(loggingAdapter.getRawData('0xpool_error')).rejects.toThrow('Simulated RPC Error');

    expect(customLogger.log).toHaveBeenCalledWith('getRawData called for pool: 0xpool_error');
    expect(customLogger.error).toHaveBeenCalledWith('getRawData threw error for pool: 0xpool_error', error);
  });
});
