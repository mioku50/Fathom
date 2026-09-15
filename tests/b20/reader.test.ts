import { describe, it, expect, vi } from 'vitest';
import { detectAssetType, readB20State } from '../../src/b20/reader';
import { readB20Context } from '../../src/b20';

const TSLAC = '0xb2000000000000000000001e800a7f5189430cD0';
const AERO = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';
const UNKNOWN_B20 = '0xb200000000000000000000000000000000000001';
const WAD = 10n ** 18n;

const ok = (result: any) => ({ status: 'success', result });
const fail = () => ({ status: 'failure', error: new Error('execution reverted') });

/**
 * A client whose multicall answers by function name, so each test states only
 * the reads it cares about. `registry` is the raw-selector call.
 */
function client(opts: {
  isB20?: boolean;
  initialized?: boolean;
  reads?: Record<string, any>;
  registry?: string | null | (() => never);
}) {
  const reads = opts.reads ?? {};
  return {
    multicall: vi.fn(async ({ contracts }: any) =>
      contracts.map((c: any) => {
        if (c.functionName === 'isB20') return ok(opts.isB20 ?? false);
        if (c.functionName === 'isB20Initialized') return ok(opts.initialized ?? true);
        const key =
          c.functionName === 'policyId'
            ? `policyId:${String(c.args?.[0]).slice(0, 10)}`
            : c.functionName;
        const match = key in reads ? reads[key] : reads[c.functionName];
        return match === undefined ? fail() : ok(match);
      })
    ),
    client: {
      call: vi.fn(async () => {
        if (typeof opts.registry === 'function') (opts.registry as () => never)();
        return { data: opts.registry ?? undefined };
      })
    }
  };
}

/** `(uint256 multiplier, bool paused)` as the registry returns it. */
function registryWord(multiplierWad: bigint, paused: boolean) {
  return '0x' + multiplierWad.toString(16).padStart(64, '0') + (paused ? '1' : '0').padStart(64, '0');
}

describe('B20 detection', () => {
  it('leaves a plain ERC-20 completely alone', async () => {
    const rpc = client({ isB20: false });
    const ctx = await readB20Context(rpc as any, AERO, 1.23);

    expect(ctx.asset_type).toBe('erc20');
    expect(ctx.b20).toBeNull();
    expect(ctx.stock_reference).toBeNull();
    expect(ctx.flags).toEqual([]);
    // Detection is one call; nothing else is read for an ordinary token.
    expect(rpc.multicall).toHaveBeenCalledTimes(1);
  });

  it('identifies a verified Coinbase stock', async () => {
    const { assetType } = await detectAssetType(client({ isB20: true }) as any, TSLAC);
    expect(assetType).toBe('b20_stock');
  });

  it('will not call an unrecognised B20 token a stock', async () => {
    // The factory is permissionless, so "is a B20 asset" is not "is an equity".
    const { assetType } = await detectAssetType(client({ isB20: true }) as any, UNKNOWN_B20);
    expect(assetType).toBe('b20_asset');
  });

  it('degrades to erc20 rather than failing when the factory is unreachable', async () => {
    const rpc = { multicall: vi.fn().mockRejectedValue(new Error('rpc down')) };
    const { assetType } = await detectAssetType(rpc as any, TSLAC);
    expect(assetType).toBe('erc20');
  });
});

describe('B20 state', () => {
  it('reads the multiplier and reports a clean token', async () => {
    const { state, flags } = await readB20State(
      client({
        reads: {
          multiplier: (WAD * 1000377n) / 1000000n,
          isPaused: false,
          'policyId:0xb81736c8': 0n,
          'policyId:0x10be5173': 0n
        },
        registry: registryWord((WAD * 1000377n) / 1000000n, false)
      }) as any,
      '0xb2000000000000000000002D0BA3164cc74f58B7',
      'b20_stock'
    );

    expect(state.underlying).toBe('GOOGL');
    expect(state.multiplier).toBeCloseTo(1.000377, 6);
    expect(state.paused).toBe(false);
    expect(state.policy_restricted).toBe(false);
    expect(state.corporate_action_pending).toBe(false);
    expect(flags).not.toContain('b20_policy_unverified');
    expect(flags).not.toContain('b20_transfer_paused');
  });

  it('leaves the scheduled-update fields null when the token does not implement them', async () => {
    // Every Coinbase tokenized stock reverts on uiMultiplier() today. Reporting
    // "nothing scheduled" off the back of a missing function would be invented.
    const { state, flags } = await readB20State(
      client({ reads: { multiplier: WAD, isPaused: false }, registry: registryWord(WAD, false) }) as any,
      TSLAC,
      'b20_stock'
    );

    expect(state.ui_multiplier).toBeNull();
    expect(state.next_ui_multiplier).toBeNull();
    expect(state.effective_at).toBeNull();
    expect(flags).toContain('b20_scheduled_update_unverified');
  });

  it('surfaces a pending multiplier change when the token does implement them', async () => {
    const at = 1800000000;
    const { state } = await readB20State(
      client({
        reads: {
          multiplier: WAD,
          uiMultiplier: WAD,
          newUIMultiplier: WAD * 2n,
          effectiveAt: BigInt(at),
          isPaused: false
        },
        registry: registryWord(WAD, false)
      }) as any,
      TSLAC,
      'b20_stock'
    );

    expect(state.ui_multiplier).toBe(1);
    expect(state.next_ui_multiplier).toBe(2);
    expect(state.effective_at).toBe(new Date(at * 1000).toISOString());
  });

  it('reports a paused transfer', async () => {
    const { state, flags } = await readB20State(
      client({ reads: { multiplier: WAD, isPaused: true }, registry: registryWord(WAD, false) }) as any,
      TSLAC,
      'b20_stock'
    );

    expect(state.paused).toBe(true);
    expect(flags).toContain('b20_transfer_paused');
  });

  it('reports a corporate action in progress from the oracle registry', async () => {
    const { state, flags } = await readB20State(
      client({ reads: { multiplier: WAD, isPaused: false }, registry: registryWord(WAD, true) }) as any,
      TSLAC,
      'b20_stock'
    );

    expect(state.corporate_action_pending).toBe(true);
    expect(flags).toContain('corporate_action_pending');
  });

  it('discards the registry answer when its multiplier disagrees with the token', async () => {
    // The registry's ABI is not published. A decode that contradicts a value we
    // can obtain from a documented source is a decode we cannot trust, so the
    // pause flag beside it is dropped rather than reported as false.
    const { state, flags } = await readB20State(
      client({
        reads: { multiplier: WAD, isPaused: false },
        registry: registryWord(WAD * 7n, false)
      }) as any,
      TSLAC,
      'b20_stock'
    );

    expect(state.corporate_action_pending).toBeNull();
    expect(flags).toContain('corporate_action_unverified');
  });

  it('never defaults an unreadable multiplier to 1.0', async () => {
    const { state, flags } = await readB20State(
      client({ reads: { isPaused: false }, registry: null }) as any,
      TSLAC,
      'b20_stock'
    );

    expect(state.multiplier).toBeNull();
    expect(flags).toContain('b20_metadata_unverified');
  });

  it('flags a configured transfer policy as unverified, never as a block', async () => {
    const { state, flags } = await readB20State(
      client({
        reads: { multiplier: WAD, isPaused: false, 'policyId:0xb81736c8': 5n, 'policyId:0x10be5173': 0n },
        registry: registryWord(WAD, false)
      }) as any,
      TSLAC,
      'b20_stock'
    );

    expect(state.policy_restricted).toBe(true);
    expect(flags).toContain('b20_policy_unverified');
  });

  it('treats an unreadable policy as unknown rather than absent', async () => {
    const { state, flags } = await readB20State(
      client({ reads: { multiplier: WAD, isPaused: false }, registry: registryWord(WAD, false) }) as any,
      TSLAC,
      'b20_stock'
    );

    expect(state.policy_restricted).toBeNull();
    expect(flags).toContain('b20_policy_unverified');
  });
});
