import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniswapV3Adapter } from '../../src/adapters/uniswap_v3';
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

describe('UniswapV3Adapter', () => {
  let adapter: UniswapV3Adapter;
  let mockMulticall: any;

  function useResolver(resolve: (contract: any) => any) {
    mockMulticall = makeMulticallMock(resolve);
    (createPublicClient as any).mockReturnValue({ multicall: mockMulticall });
    adapter = new UniswapV3Adapter('http://localhost:8545');
  }

  function useRejectingClient(error: Error) {
    mockMulticall = vi.fn().mockRejectedValue(error);
    (createPublicClient as any).mockReturnValue({ multicall: mockMulticall });
    adapter = new UniswapV3Adapter('http://localhost:8545');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useResolver(() => '0x0000000000000000000000000000000000000000');
  });

  describe('getPools', () => {
    it('should return found pools', async () => {
      // Mock finding one pool for WETH at 500 fee tier
      useResolver(({ args }: any) => {
        const [, tokenB, fee] = args;
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

      // 4 fee tiers x 2 quote tokens, now batched into a single round trip
      expect(mockMulticall).toHaveBeenCalledTimes(1);
      expect(mockMulticall.mock.calls[0][0].contracts).toHaveLength(8);
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

    it('should throw an error on RPC rate limit (429)', async () => {
      useRejectingClient(new Error('HTTP request failed: 429 Too Many Requests'));

      await expect(adapter.getPools('0x123')).rejects.toThrow(/RPC rate limit exceeded/);
    });

    it('should return no pools when the whole call fails for a non-RPC reason', async () => {
      useRejectingClient(new Error('Contract call failed'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pools = await adapter.getPools('0x123');
      consoleSpy.mockRestore();

      expect(pools).toHaveLength(0);
    });
  });

  describe('getRawData', () => {
    it('should return raw pool data', async () => {
      useResolver(({ functionName }: any) => {
        if (functionName === 'slot0') return [79228162514264337593543950336n, -276324, 0, 0, 0, 0, false];
        if (functionName === 'liquidity') return 1000000000000000000n;
        if (functionName === 'token0') return '0xToken0';
        if (functionName === 'token1') return '0xToken1';
        return null;
      });

      const data = await adapter.getRawData('0xabc123');

      expect(data).toMatchObject({
        sqrtPriceX96: 79228162514264337593543950336n,
        tick: -276324,
        liquidity: 1000000000000000000n,
        token0: '0xToken0',
        token1: '0xToken1',
        updatedAt: expect.any(Number)
      });

      // All four reads share one round trip, and therefore one block
      expect(mockMulticall).toHaveBeenCalledTimes(1);
      const { contracts, allowFailure } = mockMulticall.mock.calls[0][0];
      expect(contracts).toHaveLength(4);
      expect(allowFailure).toBe(false);
      expect(contracts.every((c: any) => c.address === '0xabc123')).toBe(true);
    });

    it('should throw an error if fetching fails', async () => {
      useRejectingClient(new Error('Network error'));

      await expect(adapter.getRawData('0xabc123')).rejects.toThrow(/Failed to fetch raw data for pool/);
    });

    it('should throw an error on RPC rate limit (429)', async () => {
      useRejectingClient(new Error('Rate limit exceeded for endpoint'));

      await expect(adapter.getRawData('0xabc123')).rejects.toThrow(/RPC rate limit exceeded/);
    });
  });
});
