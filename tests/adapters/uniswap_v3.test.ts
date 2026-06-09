import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniswapV3Adapter } from '../../src/adapters/uniswap_v3';
import { createPublicClient } from 'viem';

// Mock viem
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

describe('UniswapV3Adapter', () => {
  let adapter: UniswapV3Adapter;
  let mockReadContract: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReadContract = vi.fn();
    (createPublicClient as any).mockReturnValue({
      readContract: mockReadContract
    });

    adapter = new UniswapV3Adapter();
  });

  describe('getPools', () => {
    it('should return found pools', async () => {
      // Mock finding one pool for WETH at 500 fee tier
      mockReadContract.mockImplementation(async ({ args }) => {
        const [tokenA, tokenB, fee] = args;
        if (tokenB === '0x4200000000000000000000000000000000000006' && fee === 500) {
          return '0xabc123';
        }
        return '0x0000000000000000000000000000000000000000';
      });

      const pools = await adapter.getPools('0x123');

      expect(pools).toHaveLength(1);
      expect(pools[0]).toEqual({
        address: '0xabc123',
        dex: 'uniswap_v3',
        fee: 0.0005
      });

      // Should have checked 4 fee tiers for both WETH and USDC (8 calls)
      expect(mockReadContract).toHaveBeenCalledTimes(8);
    });

    it('should handle contract errors gracefully', async () => {
      mockReadContract.mockRejectedValue(new Error('Contract call failed'));

      const pools = await adapter.getPools('0x123');

      expect(pools).toHaveLength(0);
    });

    it('should throw an error on RPC rate limit (429)', async () => {
      mockReadContract.mockRejectedValue(new Error('HTTP request failed: 429 Too Many Requests'));

      await expect(adapter.getPools('0x123')).rejects.toThrow(/RPC rate limit exceeded/);
    });
  });

  describe('getRawData', () => {
    it('should return raw pool data', async () => {
      // Mock slot0 and liquidity
      mockReadContract.mockImplementation(async ({ functionName }) => {
        if (functionName === 'slot0') {
          return [
            123456789n, // sqrtPriceX96
            100,        // tick
            0,
            0,
            0,
            0,
            true
          ];
        }
        if (functionName === 'liquidity') {
          return 987654321n;
        }
        throw new Error('Unknown function');
      });

      const data = await adapter.getRawData('0xabc123');

      expect(data).toEqual({
        sqrtPriceX96: 123456789n,
        tick: 100,
        liquidity: 987654321n,
        updatedAt: expect.any(Number)
      });

      expect(mockReadContract).toHaveBeenCalledTimes(2);
      expect(mockReadContract.mock.calls[0][0].address).toBe('0xabc123');
      expect(mockReadContract.mock.calls[1][0].address).toBe('0xabc123');
    });

    it('should throw an error if fetching fails', async () => {
      mockReadContract.mockRejectedValue(new Error('Network error'));

      await expect(adapter.getRawData('0xabc123')).rejects.toThrow(/Failed to fetch raw data for pool/);
    });

    it('should throw an error on RPC rate limit (429)', async () => {
      mockReadContract.mockRejectedValue(new Error('Rate limit exceeded for endpoint'));

      await expect(adapter.getRawData('0xabc123')).rejects.toThrow(/RPC rate limit exceeded/);
    });
  });
});
