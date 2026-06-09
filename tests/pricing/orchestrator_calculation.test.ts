import { describe, it, expect } from 'vitest';
import { DEXOrchestrator } from '../../src/orchestrator';
import { MockDEXAdapter } from './mock_dex_adapter';
import { PriceCalculator } from '../../src/calculator';
import { PoolInfo, RawPoolData } from '../../src/dex_adapter';

describe('DEXOrchestrator Pricing Calculations', () => {
  it('should fetch raw data and calculate correct prices for a simulated V2 pool', async () => {
    const uniV2 = new MockDEXAdapter('uniswap_v2');

    const poolInfo: PoolInfo = { address: '0xpool_v2', dex: 'uniswap_v2', fee: 0.003 };
    uniV2.setPools('0xtokenA', [poolInfo]);

    // Token = 1000 units (6 decimals) -> 0.001
    // Quote = 2000 units (18 decimals) -> 0.000000000000002
    // price = 2 * 10^-12
    const rawData: RawPoolData = {
      reserve0: 1000000n, // Token (token0)
      reserve1: 2000000000000000000n, // Quote (token1)
      updatedAt: Date.now()
    };
    uniV2.setRawData('0xpool_v2', rawData);

    const orchestrator = new DEXOrchestrator([uniV2]);
    const pools = await orchestrator.getAllPools('0xtokenA');
    const allData = await orchestrator.getAllRawData(pools);

    expect(allData).toHaveLength(1);
    const data = allData[0].rawData;

    const result = PriceCalculator.calculatePoolPriceAndLiquidity(data, true, 6, 18);

    // R_Token = 1000000 / 1e6 = 1
    // R_Quote = 2000000000000000000 / 1e18 = 2
    // Price in quote = 2 / 1 = 2
    // Liquidity in quote = 2 * 2 = 4

    expect(result.priceInQuote).toBe(2);
    expect(result.liquidityInQuote).toBe(4);
  });

  it('should fetch raw data and calculate correct prices for a simulated V3 pool', async () => {
    const uniV3 = new MockDEXAdapter('uniswap_v3');

    const poolInfo: PoolInfo = { address: '0xpool_v3', dex: 'uniswap_v3', fee: 0.003 };
    uniV3.setPools('0xtokenA', [poolInfo]);

    // 1:1 price
    // sqrtP = 1 -> sqrtPriceX96 = 2^96 = 79228162514264337593543950336
    const rawData: RawPoolData = {
      sqrtPriceX96: 79228162514264337593543950336n,
      liquidity: 1000000000000000000n, // 1 * 1e18
      tick: 0,
      updatedAt: Date.now()
    };
    uniV3.setRawData('0xpool_v3', rawData);

    const orchestrator = new DEXOrchestrator([uniV3]);
    const pools = await orchestrator.getAllPools('0xtokenA');
    const allData = await orchestrator.getAllRawData(pools);

    expect(allData).toHaveLength(1);
    const data = allData[0].rawData;

    const result = PriceCalculator.calculatePoolPriceAndLiquidity(data, true, 18, 18);

    // Price should be very close to 1
    expect(result.priceInQuote).toBeCloseTo(1, 5);
    // Liquidity = 1e18 * 1 = 1e18, in quote = 1e18 / 1e18 * 2 = 2
    expect(result.liquidityInQuote).toBeCloseTo(2, 5);
  });

  it('should aggregate data from multiple adapters and calculate prices', async () => {
    const v2Adapter = new MockDEXAdapter('uniswap_v2');
    const v3Adapter = new MockDEXAdapter('uniswap_v3');

    v2Adapter.setPools('0xtokenB', [{ address: '0xpool_1', dex: 'uniswap_v2', fee: 0.003 }]);
    v2Adapter.setRawData('0xpool_1', {
      reserve0: 10n * 10n**18n,
      reserve1: 20n * 10n**18n,
      updatedAt: Date.now()
    });

    v3Adapter.setPools('0xtokenB', [{ address: '0xpool_2', dex: 'uniswap_v3', fee: 0.003 }]);
    v3Adapter.setRawData('0xpool_2', {
      sqrtPriceX96: 79228162514264337593543950336n,
      liquidity: 10n * 10n**18n,
      tick: 0,
      updatedAt: Date.now()
    });

    const orchestrator = new DEXOrchestrator([v2Adapter, v3Adapter]);
    const pools = await orchestrator.getAllPools('0xtokenB');
    const allData = await orchestrator.getAllRawData(pools);

    expect(allData).toHaveLength(2);

    const pricesAndLiquidity = allData.map(item =>
      PriceCalculator.calculatePoolPriceAndLiquidity(item.rawData, true, 18, 18)
    );

    // v2 pool price = 20 / 10 = 2, liq = 20 * 2 = 40
    // v3 pool price = 1, liq = 10 * 2 = 20
    const v2Result = pricesAndLiquidity.find(p => p.priceInQuote === 2);
    expect(v2Result).toBeDefined();
    expect(v2Result?.liquidityInQuote).toBe(40);

    const v3Result = pricesAndLiquidity.find(p => Math.abs(p.priceInQuote - 1) < 0.001);
    expect(v3Result).toBeDefined();
    expect(v3Result?.liquidityInQuote).toBeCloseTo(20, 5);
  });
});
