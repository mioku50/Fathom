import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AerodromeAdapter } from '../../src/adapters/aerodrome';
import { createPublicClient } from 'viem';
import { makeMulticallMock } from './multicall_mock';

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
  let mockMulticall: any;

  function useResolver(resolve: (contract: any) => any) {
    mockMulticall = makeMulticallMock(resolve);
    (createPublicClient as any).mockReturnValue({ multicall: mockMulticall });
    adapter = new AerodromeAdapter('http://localhost:8545');
  }

  function useRejectingClient(error: Error) {
    mockMulticall = vi.fn().mockRejectedValue(error);
    (createPublicClient as any).mockReturnValue({ multicall: mockMulticall });
    adapter = new AerodromeAdapter('http://localhost:8545');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useResolver(() => '0x0000000000000000000000000000000000000000');
  });

  describe('getPools', () => {
    it('should return found pools', async () => {
      // Mock finding one stable pool for WETH
      useResolver(({ args }: any) => {
        const [, tokenB, stable] = args;
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
        fee: 0.0005,
        // stable pools use x3y+y3x, so depth math must not treat them as x*y=k
        stable: true
      });

      // volatile + stable for WETH and USDC, batched into a single round trip
      expect(mockMulticall).toHaveBeenCalledTimes(1);
      expect(mockMulticall.mock.calls[0][0].contracts).toHaveLength(4);
    });

    it('should skip probes that revert', async () => {
      useResolver(() => {
        throw new Error('Contract call failed');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pools = await adapter.getPools('0x123');
      consoleSpy.mockRestore();

      expect(pools).toHaveLength(0);
    });

    it('should explicitly handle rate limit errors', async () => {
      useRejectingClient(new Error('HTTP request failed: 429 Too Many Requests'));

      await expect(adapter.getPools('0x123')).rejects.toThrow(
        'RPC rate limit exceeded while checking pools for 0x123'
      );
    });
  });

  describe('getRawData', () => {
    it('should return raw pool data', async () => {
      useResolver(({ functionName }: any) => {
        if (functionName === 'getReserves') return [1000000n, 2000000n, 1670000000];
        if (functionName === 'token0') return '0xToken0';
        if (functionName === 'token1') return '0xToken1';
        return '0xPoolAddress';
      });

      const data = await adapter.getRawData('0xabc123');

      expect(data).toEqual({
        reserve0: 1000000n,
        reserve1: 2000000n,
        token0: '0xToken0',
        token1: '0xToken1',
        updatedAt: 1670000000,
      });

      expect(mockMulticall).toHaveBeenCalledTimes(1);
      const callNames = mockMulticall.mock.calls[0][0].contracts.map((c: any) => c.functionName);
      expect(callNames).toEqual(['getReserves', 'token0', 'token1']);
    });

    it('should throw an error if fetching fails', async () => {
      useRejectingClient(new Error('Network error'));

      await expect(adapter.getRawData('0xabc123')).rejects.toThrow(/Failed to fetch raw data for pool/);
    });

    it('should explicitly handle rate limit errors on getRawData', async () => {
      useRejectingClient(new Error('Rate limit exceeded. Try again in 10s'));

      await expect(adapter.getRawData('0xabc123')).rejects.toThrow(
        'RPC rate limit exceeded while fetching raw data for pool 0xabc123'
      );
    });
  });
});
