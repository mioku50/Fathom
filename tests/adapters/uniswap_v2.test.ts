import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniswapV2Adapter } from '../../src/adapters/uniswap_v2';
import * as viem from 'viem';
import { makeMulticallMock } from './multicall_mock';

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

describe('UniswapV2Adapter', () => {
  let adapter: UniswapV2Adapter;
  let mockMulticall: any;

  function useResolver(resolve: (contract: any) => any) {
    mockMulticall = makeMulticallMock(resolve);
    (viem.createPublicClient as any).mockReturnValue({ multicall: mockMulticall });
    adapter = new UniswapV2Adapter('http://localhost:8545');
  }

  function useRejectingClient(error: Error) {
    mockMulticall = vi.fn().mockRejectedValue(error);
    (viem.createPublicClient as any).mockReturnValue({ multicall: mockMulticall });
    adapter = new UniswapV2Adapter('http://localhost:8545');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useResolver(() => '0x0000000000000000000000000000000000000000');
  });

  describe('getPools', () => {
    it('should find pools for valid tokens', async () => {
      useResolver(() => '0xPoolAddress');

      const pools = await adapter.getPools('0xTokenAddress');

      expect(pools.length).toBeGreaterThan(0);
      expect(pools[0]).toEqual({
        address: '0xPoolAddress',
        dex: 'uniswap_v2',
        fee: 0.003,
      });

      // Both quote tokens probed in a single round trip
      expect(mockMulticall).toHaveBeenCalledTimes(1);
      expect(mockMulticall.mock.calls[0][0].contracts).toHaveLength(2);
    });

    it('should handle zero address gracefully', async () => {
      useResolver(() => '0x0000000000000000000000000000000000000000');

      const pools = await adapter.getPools('0xTokenAddress');

      expect(pools.length).toBe(0);
    });

    it('should skip probes that revert', async () => {
      useResolver(() => {
        throw new Error('Contract call failed');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pools = await adapter.getPools('0xTokenAddress');
      consoleSpy.mockRestore();

      expect(pools.length).toBe(0);
    });

    it('should explicitly handle rate limit errors', async () => {
      useRejectingClient(new Error('HTTP request failed: 429 Too Many Requests'));

      await expect(adapter.getPools('0xTokenAddress')).rejects.toThrow(
        'RPC rate limit exceeded while checking pools for 0xTokenAddress'
      );
    });

    it('should explicitly handle different rate limit error messages', async () => {
      useRejectingClient(new Error('rate limit exceeded for endpoint'));

      await expect(adapter.getPools('0xTokenAddress')).rejects.toThrow(
        'RPC rate limit exceeded while checking pools for 0xTokenAddress'
      );
    });
  });

  describe('getRawData', () => {
    it('should return reserves correctly', async () => {
      useResolver(({ functionName }: any) => {
        if (functionName === 'getReserves') return [1000000000000000000n, 2000000000000000000n, 1620000000];
        if (functionName === 'token0') return '0xToken0';
        if (functionName === 'token1') return '0xToken1';
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

      expect(mockMulticall).toHaveBeenCalledTimes(1);
    });

    it('should throw an error on failure', async () => {
      useRejectingClient(new Error('Contract call failed'));

      await expect(adapter.getRawData('0xPoolAddress')).rejects.toThrow(
        'Failed to fetch raw data for pool 0xPoolAddress: Contract call failed'
      );
    });

    it('should explicitly handle rate limit errors on getRawData', async () => {
      useRejectingClient(new Error('Rate limit exceeded. Try again in 10s'));

      await expect(adapter.getRawData('0xPoolAddress')).rejects.toThrow(
        'RPC rate limit exceeded while fetching raw data for pool 0xPoolAddress'
      );
    });
  });
});
