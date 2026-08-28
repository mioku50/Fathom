import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniswapV4Adapter, NATIVE_ETH } from '../../src/adapters/uniswap_v4';
import { createPublicClient } from 'viem';
import { makeMulticallMock } from './multicall_mock';

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return { ...actual, createPublicClient: vi.fn() };
});

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TOKEN = '0xffff89fcd6edb6e08f4c7c32d4f71b54bda02913'; // sorts after USDC

describe('UniswapV4Adapter', () => {
  let adapter: UniswapV4Adapter;
  let mockMulticall: any;

  function build(resolve: (c: any) => any) {
    mockMulticall = makeMulticallMock(resolve);
    (createPublicClient as any).mockReturnValue({ multicall: mockMulticall });
    adapter = new UniswapV4Adapter('http://localhost:8545');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    build(() => [0n, 0, 0, 0]);
  });

  describe('poolId', () => {
    it('is deterministic and sensitive to every part of the key', () => {
      const key = { currency0: NATIVE_ETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: NATIVE_ETH };
      const id = UniswapV4Adapter.poolId(key);

      expect(id).toMatch(/^0x[0-9a-f]{64}$/);
      expect(UniswapV4Adapter.poolId(key)).toBe(id);
      expect(UniswapV4Adapter.poolId({ ...key, fee: 500 })).not.toBe(id);
      expect(UniswapV4Adapter.poolId({ ...key, tickSpacing: 10 })).not.toBe(id);
      expect(UniswapV4Adapter.poolId({ ...key, hooks: USDC })).not.toBe(id);
    });
  });

  describe('getPools', () => {
    it('keeps only initialised pools', async () => {
      // Only the fee=3000 key has ever been created.
      build(({ functionName, args }: any) => {
        if (functionName !== 'getSlot0') return null;
        const wanted = UniswapV4Adapter.poolId({
          currency0: USDC, currency1: TOKEN, fee: 3000, tickSpacing: 60, hooks: NATIVE_ETH
        });
        return args[0] === wanted ? [123n, 5, 0, 3000] : [0n, 0, 0, 0];
      });

      const pools = await adapter.getPools(TOKEN);

      expect(pools).toHaveLength(1);
      expect(pools[0].dex).toBe('uniswap_v4');
      expect(pools[0].v4Key).toEqual({
        currency0: USDC, currency1: TOKEN, fee: 3000, tickSpacing: 60, hooks: NATIVE_ETH
      });
      // the PoolId stands in for an address, since v4 pools have none
      expect(pools[0].address).toBe(UniswapV4Adapter.poolId(pools[0].v4Key!));
    });

    it('probes native ETH as well as the wrapped and stable quotes', async () => {
      build(() => [0n, 0, 0, 0]);
      await adapter.getPools(TOKEN);

      const { contracts } = mockMulticall.mock.calls[0][0];
      // 4 quote assets x 4 fee tiers
      expect(contracts).toHaveLength(16);
      expect(mockMulticall).toHaveBeenCalledTimes(1);
    });

    it('sorts currencies so the key matches what the PoolManager stored', async () => {
      build(() => [1n, 0, 0, 3000]);
      const pools = await adapter.getPools(TOKEN);

      for (const p of pools) {
        expect(p.v4Key!.currency0.toLowerCase() < p.v4Key!.currency1.toLowerCase()).toBe(true);
      }
    });

    it('never probes a token against itself', async () => {
      build(() => [0n, 0, 0, 0]);
      await adapter.getPools(USDC);

      // one of the four quote assets is USDC itself, so a tier is dropped
      expect(mockMulticall.mock.calls[0][0].contracts).toHaveLength(12);
    });
  });

  describe('getRawData', () => {
    it('reads through StateView and takes currencies from the key', async () => {
      build(({ functionName }: any) => {
        if (functionName === 'getSlot0') return [79228162514264337593543950336n, -100, 0, 3000];
        if (functionName === 'getLiquidity') return 5000n;
        return null;
      });

      const pool = {
        address: '0xpoolid', dex: 'uniswap_v4',
        v4Key: { currency0: NATIVE_ETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: NATIVE_ETH }
      };
      const data = await adapter.getRawData(pool.address, pool);

      expect(data).toMatchObject({
        sqrtPriceX96: 79228162514264337593543950336n,
        tick: -100,
        liquidity: 5000n,
        // the singleton has no per-pool contract to ask for these
        token0: NATIVE_ETH,
        token1: USDC
      });
    });
  });

  describe('quoteSell', () => {
    it('derives swap direction from the sorted key', async () => {
      build(() => [999n, 0n]);

      const key = { currency0: NATIVE_ETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: NATIVE_ETH };

      await adapter.quoteSell({
        pool: { address: '0xid', dex: 'uniswap_v4', v4Key: key },
        tokenIn: USDC, tokenOut: NATIVE_ETH, amountsIn: [1n]
      });
      expect(mockMulticall.mock.calls[0][0].contracts[0].args[0].zeroForOne).toBe(false);

      vi.clearAllMocks();
      await adapter.quoteSell({
        pool: { address: '0xid', dex: 'uniswap_v4', v4Key: key },
        tokenIn: NATIVE_ETH, tokenOut: USDC, amountsIn: [1n]
      });
      expect(mockMulticall.mock.calls[0][0].contracts[0].args[0].zeroForOne).toBe(true);
    });

    it('cannot quote a pool that arrived without its key', async () => {
      const out = await adapter.quoteSell({
        pool: { address: '0xid', dex: 'uniswap_v4' },
        tokenIn: USDC, tokenOut: NATIVE_ETH, amountsIn: [1n, 2n]
      });

      expect(out).toEqual([null, null]);
      expect(mockMulticall).not.toHaveBeenCalled();
    });

    it('reports an unfillable size as null', async () => {
      build(() => { throw new Error('PoolNotInitialized'); });

      const out = await adapter.quoteSell({
        pool: {
          address: '0xid', dex: 'uniswap_v4',
          v4Key: { currency0: NATIVE_ETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: NATIVE_ETH }
        },
        tokenIn: USDC, tokenOut: NATIVE_ETH, amountsIn: [1n]
      });

      expect(out).toEqual([null]);
    });
  });
});
