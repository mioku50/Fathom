import { describe, it, expect, vi } from 'vitest';
import { DEXOrchestrator } from '../../src/orchestrator';
import { MockDEXAdapter } from './mock_dex_adapter';
import { PriceCalculator } from '../../src/calculator';

describe('PriceCalculator with MockDEXAdapter Logging', () => {
  it('should calculate prices correctly when MockDEXAdapter logging is enabled (boolean flag)', async () => {
    // Create mock adapter with boolean logging enabled
    const adapter = new MockDEXAdapter('logging_mock_v2', true);

    // Silence console.log for this test to avoid noisy output, or capture it
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    adapter.setPools('0xtokenA', [{ address: '0xpool_1', dex: 'logging_mock_v2', fee: 0.003 }]);
    adapter.setRawData('0xpool_1', {
      reserve0: 1000000n, // Token (token0), 1e6
      reserve1: 2000000000000000000n, // Quote (token1), 2e18
      updatedAt: Date.now()
    });

    const orchestrator = new DEXOrchestrator([adapter]);
    const pools = await orchestrator.getAllPools('0xtokenA');
    const allData = await orchestrator.getAllRawData(pools);

    expect(allData).toHaveLength(1);

    const data = allData[0].rawData;
    const result = PriceCalculator.calculatePoolPriceAndLiquidity(data, true, 6, 18);

    // Price should be 2. Liquidity should be 4.
    expect(result.priceInQuote).toBe(2);
    expect(result.liquidityInQuote).toBe(4);

    // Verify logging actually happened
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should calculate prices correctly when MockDEXAdapter uses custom Logger object', async () => {
    const customLogger = {
      log: vi.fn(),
      error: vi.fn()
    };

    const adapter = new MockDEXAdapter('custom_logging_mock_v3', customLogger);

    adapter.setPools('0xtokenB', [{ address: '0xpool_2', dex: 'custom_logging_mock_v3', fee: 0.003 }]);
    adapter.setRawData('0xpool_2', {
      sqrtPriceX96: 79228162514264337593543950336n, // 1:1 price
      liquidity: 1000000000000000000n, // 1e18
      tick: 0,
      updatedAt: Date.now()
    });

    const orchestrator = new DEXOrchestrator([adapter]);
    const pools = await orchestrator.getAllPools('0xtokenB');
    const allData = await orchestrator.getAllRawData(pools);

    expect(allData).toHaveLength(1);

    const data = allData[0].rawData;
    const result = PriceCalculator.calculatePoolPriceAndLiquidity(data, true, 18, 18);

    // Price should be 1. Liquidity should be 2.
    expect(result.priceInQuote).toBeCloseTo(1, 5);
    expect(result.liquidityInQuote).toBeCloseTo(2, 5);

    // Verify custom logger was called
    expect(customLogger.log).toHaveBeenCalledWith(expect.stringContaining('getPools called for token: 0xtokenB'));
    expect(customLogger.log).toHaveBeenCalledWith(expect.stringContaining('getRawData called for pool: 0xpool_2'));
  });
});
