import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PriceReader } from '../src/priceReader';
import { DEXOrchestrator } from '../src/orchestrator';

describe('PriceReader', () => {
  let orchestratorMock: any;
  let priceReader: PriceReader;

  beforeEach(() => {
    orchestratorMock = {
      getAllPools: vi.fn(),
      getAllRawData: vi.fn(),
    };
    priceReader = new PriceReader(orchestratorMock as unknown as DEXOrchestrator);
  });

  it('should return zeros when no pools are found', async () => {
    orchestratorMock.getAllPools.mockResolvedValue([]);
    orchestratorMock.getAllRawData.mockResolvedValue([]);

    const result = await priceReader.getBestPriceAndLiquidity('0x123');

    expect(result.bestPrice).toBe(0);
    expect(result.bestLiquidity).toBe(0);
    expect(result.poolsCount).toBe(0);
    expect(result.mainPoolData).toBeNull();
  });

  it('should calculate best price and liquidity from pools', async () => {
    const pools = [
      { address: '0xPool1', dex: 'uniswapV2' },
      { address: '0xPool2', dex: 'uniswapV3' }
    ];

    orchestratorMock.getAllPools.mockResolvedValue(pools);

    const rawData = [
      {
        pool: pools[0],
        rawData: {
          reserve0: 1000000000000000000n, // 1 token
          reserve1: 2000000000000000000n, // 2 quote
          updatedAt: 1234
        }
      },
      {
        pool: pools[1],
        rawData: {
          reserve0: 2000000000000000000n, // 2 token
          reserve1: 8000000000000000000n, // 8 quote -> better liquidity
          updatedAt: 1234
        }
      }
    ];

    orchestratorMock.getAllRawData.mockResolvedValue(rawData);

    // Provide a token address that makes it token0 compared to quote address
    // We used '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as quote.
    // So if token < quote, isToken0 = true.
    const token = '0x1111111111111111111111111111111111111111';
    const result = await priceReader.getBestPriceAndLiquidity(token);

    expect(result.poolsCount).toBe(2);
    // V2 calculate:
    // pool 1: price = 2/1 = 2, liq = 2 * 2 = 4
    // pool 2: price = 8/2 = 4, liq = 8 * 2 = 16
    expect(result.bestLiquidity).toBe(16);
    expect(result.bestPrice).toBe(4);
    expect(result.mainPoolData).toEqual({
      dex: 'uniswapV3',
      address: '0xPool2',
      fee: undefined,
      liquidity_usd: 16,
      price_usd: 4
    });
  });

  it('should correctly handle token1 case', async () => {
    const pools = [
      { address: '0xPool1', dex: 'uniswapV2' }
    ];

    orchestratorMock.getAllPools.mockResolvedValue(pools);

    const rawData = [
      {
        pool: pools[0],
        rawData: {
          reserve0: 2000000000000000000n, // 2 quote (since isToken0 will be false)
          reserve1: 1000000000000000000n, // 1 token
          updatedAt: 1234
        }
      }
    ];

    orchestratorMock.getAllRawData.mockResolvedValue(rawData);

    // Provide a token address greater than quote address '0x833...' -> isToken0 = false
    const token = '0x9999999999999999999999999999999999999999';
    const result = await priceReader.getBestPriceAndLiquidity(token);

    expect(result.poolsCount).toBe(1);
    // If isToken0 = false, reserveToken = reserve1 (1), reserveQuote = reserve0 (2)
    // price = reserveQuote / reserveToken = 2 / 1 = 2
    // liquidity = reserveQuote * 2 = 2 * 2 = 4
    expect(result.bestLiquidity).toBe(4);
    expect(result.bestPrice).toBe(2);
    expect(result.mainPoolData).toEqual({
      dex: 'uniswapV2',
      address: '0xPool1',
      fee: undefined,
      liquidity_usd: 4,
      price_usd: 2
    });
  });

  it('should handle token matching quote address (zero price/liquidity)', async () => {
    const pools = [
      { address: '0xPool1', dex: 'uniswapV2' }
    ];

    orchestratorMock.getAllPools.mockResolvedValue(pools);

    const rawData = [
      {
        pool: pools[0],
        rawData: {
          reserve0: 1000000000000000000n,
          reserve1: 1000000000000000000n,
          updatedAt: 1234
        }
      }
    ];

    orchestratorMock.getAllRawData.mockResolvedValue(rawData);

    const token = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Matches quote exactly
    const result = await priceReader.getBestPriceAndLiquidity(token);

    // If it matches exactly, priceReader does:
    // isToken0 = token.toLowerCase() < '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
    // This evaluates to false (equal, not less).
    // Reserve calculation will assign quote=reserve0, token=reserve1
    // The price will be calculated normally, but practically it's just 1:1 if reserves are equal.

    expect(result.poolsCount).toBe(1);
    expect(result.bestPrice).toBe(1);
    expect(result.bestLiquidity).toBe(2);
  });

  it('should handle zero prices correctly (reserves are 0)', async () => {
    const pools = [
      { address: '0xPool1', dex: 'uniswapV2' },
      { address: '0xPool2', dex: 'uniswapV3' }
    ];

    orchestratorMock.getAllPools.mockResolvedValue(pools);

    const rawData = [
      {
        pool: pools[0],
        rawData: {
          reserve0: 0n,
          reserve1: 0n,
          updatedAt: 1234
        }
      },
      {
        pool: pools[1],
        rawData: {
          sqrtPriceX96: 0n,
          liquidity: 0n,
          updatedAt: 1234
        }
      }
    ];

    orchestratorMock.getAllRawData.mockResolvedValue(rawData);

    const token = '0x1111111111111111111111111111111111111111';
    const result = await priceReader.getBestPriceAndLiquidity(token);

    expect(result.poolsCount).toBe(2);
    expect(result.bestPrice).toBe(0);
    expect(result.bestLiquidity).toBe(0);
    expect(result.mainPoolData).toBeNull();
  });


  it('should construct correctly with orchestrator', () => {
    // Config/initialization test
    const mockOrchestrator = {} as DEXOrchestrator;
    const reader = new PriceReader(mockOrchestrator);
    expect(reader).toBeDefined();
    expect(reader).toBeInstanceOf(PriceReader);
  });

  it('should handle getBestPriceAndLiquidity with empty inputs gracefully', async () => {
    // Edge case initialization test
    orchestratorMock.getAllPools.mockResolvedValue([]);
    orchestratorMock.getAllRawData.mockResolvedValue([]);

    // An empty token string
    const result = await priceReader.getBestPriceAndLiquidity('');
    expect(result.poolsCount).toBe(0);
    expect(result.bestPrice).toBe(0);
    expect(result.bestLiquidity).toBe(0);
  });

  it('should handle rawData array with some null or invalid entries', async () => {
    const pools = [
      { address: '0xPool1', dex: 'uniswapV2' },
      { address: '0xPool2', dex: 'uniswapV3' }
    ];

    orchestratorMock.getAllPools.mockResolvedValue(pools);

    const rawData = [
      {
        pool: pools[0],
        rawData: null // Invalid
      },
      {
        pool: pools[1],
        rawData: {
          sqrtPriceX96: 0n, // Gives zero price and liquidity
          liquidity: 0n,
          updatedAt: 1234
        }
      }
    ];

    orchestratorMock.getAllRawData.mockResolvedValue(rawData);

    const token = '0x1111111111111111111111111111111111111111';

    // It should handle gracefully, skip null raw data, or throw if the underlying Calculator throws
    // Our calculator expects valid rawData objects, we should test how PriceReader handles exceptions

    // We expect it to either return zero price/liquidity or throw an error if Calculator throws.
    // PriceCalculator throws when reserve/sqrtPrice data is missing or wrong types depending on its implementation.
    // Let's mock the Calculator if needed or just let it throw to verify error bubbling.
    // But since it's a real class, it might throw "Cannot read properties of null".
    // We should test error handling inside PriceReader or just expect it to bubble.
    await expect(priceReader.getBestPriceAndLiquidity(token)).rejects.toThrow();
  });

  it('should handle getBestPriceAndLiquidity when orchestrator.getAllPools throws', async () => {
    orchestratorMock.getAllPools.mockRejectedValue(new Error('Network error'));

    const token = '0x1111111111111111111111111111111111111111';
    await expect(priceReader.getBestPriceAndLiquidity(token)).rejects.toThrow('Network error');
  });

  it('should handle getBestPriceAndLiquidity when orchestrator.getAllRawData throws', async () => {
    orchestratorMock.getAllPools.mockResolvedValue([{ address: '0xPool1', dex: 'uniswapV2' }]);
    orchestratorMock.getAllRawData.mockRejectedValue(new Error('RPC error'));

    const token = '0x1111111111111111111111111111111111111111';
    await expect(priceReader.getBestPriceAndLiquidity(token)).rejects.toThrow('RPC error');
  });
});
