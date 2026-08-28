import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AerodromeSlipstreamAdapter } from '../../src/adapters/aerodrome_slipstream';
import { createPublicClient } from 'viem';
import { makeMulticallMock } from './multicall_mock';

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return { ...actual, createPublicClient: vi.fn() };
});

const V2_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const CL_A = '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A';
const CL_B = '0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a';
const ZERO = '0x0000000000000000000000000000000000000000';

describe('AerodromeSlipstreamAdapter', () => {
  let adapter: AerodromeSlipstreamAdapter;
  let mockMulticall: any;
  let mockReadContract: any;

  function build(opts: {
    factories?: string[];
    resolve?: (c: any) => any;
    readContract?: any;
  } = {}) {
    mockReadContract = opts.readContract ?? vi.fn(async () => opts.factories ?? [V2_FACTORY, CL_A]);
    mockMulticall = makeMulticallMock(opts.resolve ?? (() => ZERO));
    (createPublicClient as any).mockReturnValue({
      multicall: mockMulticall,
      readContract: mockReadContract
    });
    adapter = new AerodromeSlipstreamAdapter('http://localhost:8545');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    build();
  });

  describe('getPools', () => {
    it('drops factories with no tickSpacings instead of hardcoding exclusions', async () => {
      build({
        factories: [V2_FACTORY, CL_A],
        resolve: (c: any) => {
          if (c.functionName === 'tickSpacings') {
            // the v2 factory has no such function
            if (c.address === V2_FACTORY) throw new Error('reverted');
            return [100n, 200n];
          }
          return ZERO;
        }
      });

      await adapter.getPools('0xToken');

      // getPool probes: 1 CL factory x 2 tick spacings x 2 quote tokens = 4
      const probeCall = mockMulticall.mock.calls.find((c: any) => c[0].contracts[0]?.functionName === 'getPool');
      expect(probeCall[0].contracts).toHaveLength(4);
      expect(probeCall[0].contracts.every((c: any) => c.address === CL_A)).toBe(true);
    });

    it('probes every registered CL factory and tags pools with their tick spacing', async () => {
      build({
        factories: [CL_A, CL_B],
        resolve: (c: any) => {
          if (c.functionName === 'tickSpacings') return [100n];
          // only CL_A has a pool, and only against the first quote token
          const [, quoteToken, tickSpacing] = c.args;
          if (c.address === CL_A && tickSpacing === 100 &&
              quoteToken === '0x4200000000000000000000000000000000000006') {
            return '0xPoolA';
          }
          return ZERO;
        }
      });

      const pools = await adapter.getPools('0xToken');

      expect(pools).toEqual([
        { address: '0xPoolA', dex: 'aerodrome_slipstream', tickSpacing: 100 }
      ]);
    });

    it('never reports the same pool twice when factories overlap', async () => {
      build({
        factories: [CL_A, CL_B],
        resolve: (c: any) => (c.functionName === 'tickSpacings' ? [100n] : '0xSharedPool')
      });

      const pools = await adapter.getPools('0xToken');

      expect(pools).toHaveLength(1);
      expect(pools[0].address).toBe('0xSharedPool');
    });

    it('reads the registry once per instance, not once per token', async () => {
      build({
        factories: [CL_A],
        resolve: (c: any) => (c.functionName === 'tickSpacings' ? [100n] : ZERO)
      });

      await adapter.getPools('0xTokenA');
      await adapter.getPools('0xTokenB');
      await adapter.getPools('0xTokenC');

      expect(mockReadContract).toHaveBeenCalledTimes(1);
    });

    it('does not cache a registry failure', async () => {
      const readContract = vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([CL_A]);
      build({
        readContract,
        resolve: (c: any) => (c.functionName === 'tickSpacings' ? [100n] : ZERO)
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await adapter.getPools('0xToken')).toEqual([]);
      await adapter.getPools('0xToken');
      consoleSpy.mockRestore();

      expect(readContract).toHaveBeenCalledTimes(2);
    });

    it('throws on a rate limit rather than reporting no pools', async () => {
      build({
        readContract: vi.fn().mockRejectedValue(new Error('HTTP request failed: 429 Too Many Requests'))
      });

      await expect(adapter.getPools('0xToken')).rejects.toThrow(/RPC rate limit exceeded/);
    });
  });

  describe('getRawData', () => {
    it('reads the six-field Slipstream slot0', async () => {
      build({
        resolve: ({ functionName }: any) => {
          // note: six fields, no feeProtocol - unlike Uniswap V3
          if (functionName === 'slot0') return [3911846461398431270648359n, -198332, 2708, 3010, 3010, true];
          if (functionName === 'liquidity') return 2580504348696857150n;
          if (functionName === 'token0') return '0xToken0';
          if (functionName === 'token1') return '0xToken1';
          return null;
        }
      });

      const data = await adapter.getRawData('0xPool');

      expect(data).toMatchObject({
        sqrtPriceX96: 3911846461398431270648359n,
        tick: -198332,
        liquidity: 2580504348696857150n,
        token0: '0xToken0',
        token1: '0xToken1'
      });
      expect(mockMulticall).toHaveBeenCalledTimes(1);
      expect(mockMulticall.mock.calls[0][0].allowFailure).toBe(false);
    });
  });

  describe('quoteSell', () => {
    it('passes tick spacing to the quoter where Uniswap passes a fee tier', async () => {
      build({
        resolve: () => [12345n, 0n, 1, 0n]
      });

      const out = await adapter.quoteSell({
        pool: { address: '0xPool', dex: 'aerodrome_slipstream', tickSpacing: 200 },
        tokenIn: '0xIn',
        tokenOut: '0xOut',
        amountsIn: [1n, 2n]
      });

      expect(out).toEqual([12345n, 12345n]);
      const args = mockMulticall.mock.calls[0][0].contracts[0].args[0];
      expect(args.tickSpacing).toBe(200);
      expect(args.sqrtPriceLimitX96).toBe(0n);
      expect(mockMulticall.mock.calls[0][0].contracts[0].address)
        .toBe('0x254cf9e1e6e233aa1ac962cb9b05b2cfeaae15b0');
    });

    it('cannot quote a pool with no tick spacing', async () => {
      const out = await adapter.quoteSell({
        pool: { address: '0xPool', dex: 'aerodrome_slipstream' },
        tokenIn: '0xIn',
        tokenOut: '0xOut',
        amountsIn: [1n, 2n]
      });

      expect(out).toEqual([null, null]);
      expect(mockMulticall).not.toHaveBeenCalled();
    });
  });
});
