import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AerodromeAdapter } from '../../src/adapters/aerodrome';
import { createPublicClient } from 'viem';

// Mock viem
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

describe('AerodromeAdapter', () => {
  let adapter: AerodromeAdapter;
  let mockReadContract: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReadContract = vi.fn();
    (createPublicClient as any).mockReturnValue({
      readContract: mockReadContract
    });

    adapter = new AerodromeAdapter();
  });

  describe('getPools', () => {
    it('should return found pools', async () => {
      // Mock finding one stable pool for WETH
      mockReadContract.mockImplementation(async ({ args }) => {
        const [tokenA, tokenB, stable] = args;
        if (tokenB === '0x4200000000000000000000000000000000000006' && stable === true) {
          return '0xabc123';
        }
        return '0x0000000000000000000000000000000000000000';
      });

      const pools = await adapter.getPools('0x123');

      expect(pools).toHaveLength(1);
      expect(pools[0]).toEqual({
        address: '0xabc123',
        dex: 'aerodrome',
        fee: 0.0005
      });

      // Should have checked both volatile and stable for WETH and USDC (4 calls)
      expect(mockReadContract).toHaveBeenCalledTimes(4);
    });

    it('should handle contract errors gracefully', async () => {
      mockReadContract.mockRejectedValue(new Error('Contract call failed'));

      const pools = await adapter.getPools('0x123');

      expect(pools).toHaveLength(0);
    });

    it('should explicitly handle rate limit errors', async () => {
      mockReadContract.mockRejectedValue(new Error('HTTP request failed: 429 Too Many Requests'));

      await expect(adapter.getPools('0x123')).rejects.toThrow('RPC rate limit exceeded while checking pool for 0x123 and 0x4200000000000000000000000000000000000006');
    });
  });

  describe('getRawData', () => {
    it('should return raw pool data', async () => {
      mockReadContract.mockResolvedValue([
        1000000n, // reserve0
        2000000n, // reserve1
        1670000000n // timestamp
      ]);

      const data = await adapter.getRawData('0xabc123');

      expect(data).toEqual({
        reserve0: 1000000n,
        reserve1: 2000000n,
        updatedAt: 1670000000
      });

      expect(mockReadContract).toHaveBeenCalledTimes(1);
      expect(mockReadContract.mock.calls[0][0].functionName).toBe('getReserves');
      expect(mockReadContract.mock.calls[0][0].address).toBe('0xabc123');
    });

    it('should throw an error if fetching fails', async () => {
      mockReadContract.mockRejectedValue(new Error('Network error'));

      await expect(adapter.getRawData('0xabc123')).rejects.toThrow(/Failed to fetch raw data for pool/);
    });

    it('should explicitly handle rate limit errors on getRawData', async () => {
      mockReadContract.mockRejectedValue(new Error('Rate limit exceeded. Try again in 10s'));

      await expect(adapter.getRawData('0xabc123')).rejects.toThrow('RPC rate limit exceeded while fetching raw data for pool 0xabc123');
    });
  });
});
