import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniswapV2Adapter } from '../../src/adapters/uniswap_v2';
import * as viem from 'viem';

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

describe('UniswapV2Adapter', () => {
  let adapter: UniswapV2Adapter;
  let mockReadContract: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReadContract = vi.fn();
    (viem.createPublicClient as any).mockReturnValue({
      readContract: mockReadContract,
    });

    adapter = new UniswapV2Adapter('http://localhost:8545');
  });

  describe('getPools', () => {
    it('should find pools for valid tokens', async () => {
      // Mock getPair returning a valid address
      mockReadContract.mockResolvedValue('0xPoolAddress');

      const pools = await adapter.getPools('0xTokenAddress');

      expect(pools.length).toBeGreaterThan(0);
      expect(pools[0]).toEqual({
        address: '0xPoolAddress',
        dex: 'uniswap_v2',
        fee: 0.003,
      });
    });

    it('should handle zero address gracefully', async () => {
      // Mock getPair returning zero address (no pool)
      mockReadContract.mockResolvedValue('0x0000000000000000000000000000000000000000');

      const pools = await adapter.getPools('0xTokenAddress');

      expect(pools.length).toBe(0);
    });

    it('should handle contract errors gracefully', async () => {
      // Mock getPair throwing an error
      mockReadContract.mockRejectedValue(new Error('Contract call failed'));

      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const pools = await adapter.getPools('0xTokenAddress');

      expect(pools.length).toBe(0);

      consoleSpy.mockRestore();
    });

    it('should explicitly handle rate limit errors', async () => {
      // Mock getPair throwing a rate limit error
      mockReadContract.mockRejectedValue(new Error('HTTP request failed: 429 Too Many Requests'));

      await expect(adapter.getPools('0xTokenAddress')).rejects.toThrow('RPC rate limit exceeded while checking pool for 0xTokenAddress and 0x4200000000000000000000000000000000000006');
    });

    it('should explicitly handle different rate limit error messages', async () => {
      // Mock getPair throwing a different rate limit error
      mockReadContract.mockRejectedValue(new Error('rate limit exceeded for endpoint'));

      await expect(adapter.getPools('0xTokenAddress')).rejects.toThrow('RPC rate limit exceeded while checking pool for 0xTokenAddress and 0x4200000000000000000000000000000000000006');
    });
  });

  describe('getRawData', () => {
    it('should return reserves correctly', async () => {
      // Mock getReserves
      mockReadContract.mockImplementation(async (args: any) => {
        if (args.functionName === 'getReserves') return [1000000000000000000n, 2000000000000000000n, 1620000000];
        if (args.functionName === 'token0') return '0xToken0';
        if (args.functionName === 'token1') return '0xToken1';
        return '0xPoolAddress';
      });

      const data = await adapter.getRawData('0xPoolAddress');

      expect(data).toEqual({
        reserve0: 1000000000000000000n,
        reserve1: 2000000000000000000n,
        token0: '0xToken0',
        token1: '0xToken1',
        updatedAt: 1620000000,
      });
    });

    it('should throw an error on failure', async () => {
      mockReadContract.mockRejectedValue(new Error('Contract call failed'));

      await expect(adapter.getRawData('0xPoolAddress')).rejects.toThrow('Failed to fetch raw data for pool 0xPoolAddress: Contract call failed');
    });

    it('should explicitly handle rate limit errors on getRawData', async () => {
      mockReadContract.mockRejectedValue(new Error('Rate limit exceeded. Try again in 10s'));

      await expect(adapter.getRawData('0xPoolAddress')).rejects.toThrow('RPC rate limit exceeded while fetching raw data for pool 0xPoolAddress');
    });
  });
});
