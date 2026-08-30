import { describe, expect, it, vi } from 'vitest';
import {
  UNISWAP_V4_POOL_MANAGER,
  UNISWAP_V4_START_BLOCK,
  findContractStartBlock,
  readIndexedV4PoolKeys,
  syncDemandedV4PoolIndexes,
  syncTokenV4PoolIndex,
  v4PoolIndexKey,
  v4TokenMetaKey
} from '../../src/adapters/uniswap_v4_index';

const TOKEN = '0x07e61d8a4e197dfc269e90d7ece1df0d26702ba3';
const WETH = '0x4200000000000000000000000000000000000006';
const HOOK = '0xbdf938149ac6a781f94faa0ed45e6a0e984c6544';

function memoryStore(seed: Record<string, unknown> = {}) {
  const rows = new Map<string, string>(
    Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)])
  );
  return {
    rows,
    get: vi.fn(async (key: string, type?: 'text' | 'json') => {
      const raw = rows.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key: string, value: string) => { rows.set(key, value); }),
    delete: vi.fn(async (key: string) => { rows.delete(key); }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      keys: [...rows.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })),
      list_complete: true
    }))
  };
}

function meta(over: Record<string, unknown> = {}) {
  return {
    chainId: 8453,
    poolManager: UNISWAP_V4_POOL_MANAGER,
    token: TOKEN,
    startBlock: Number(UNISWAP_V4_START_BLOCK),
    indexedThrough: Number(UNISWAP_V4_START_BLOCK) + 99,
    complete: true,
    updatedAt: 1_000_000,
    ...over
  };
}

const initialized = {
  args: {
    id: `0x${'1'.repeat(64)}`,
    currency0: TOKEN,
    currency1: WETH,
    fee: 0x800000,
    tickSpacing: 200,
    hooks: HOOK,
    sqrtPriceX96: 123n,
    tick: -197580
  }
};

describe('Uniswap v4 token event index', () => {
  it('finds contract deployment with archive bytecode reads', async () => {
    const creation = UNISWAP_V4_START_BLOCK + 37n;
    const rpc = {
      getBytecode: vi.fn(async (_token: string, block: bigint) => block >= creation ? '0x60' : undefined)
    } as any;

    await expect(findContractStartBlock(rpc, TOKEN, creation + 100n)).resolves.toBe(creation);
    expect(rpc.getBytecode.mock.calls.length).toBeLessThan(12);
  });

  it('queries only the requested token in both indexed currency positions', async () => {
    const store = memoryStore();
    const head = UNISWAP_V4_START_BLOCK + 100n;
    const rpc = {
      getBlockNumber: vi.fn(async () => head),
      getBytecode: vi.fn(async () => '0x60'),
      getLogs: vi.fn(async (args: any) => args.args.currency0 ? [initialized] : [])
    } as any;

    const result = await syncTokenV4PoolIndex(store, rpc, TOKEN, 1_100_000);

    expect(rpc.getLogs).toHaveBeenCalledTimes(2);
    expect(rpc.getLogs).toHaveBeenCalledWith(expect.objectContaining({
      args: { currency0: TOKEN },
      fromBlock: UNISWAP_V4_START_BLOCK,
      toBlock: head - 5n
    }));
    expect(rpc.getLogs).toHaveBeenCalledWith(expect.objectContaining({ args: { currency1: TOKEN } }));
    expect(result).toMatchObject({ logs: 1, complete: true, fromBlock: Number(UNISWAP_V4_START_BLOCK) });
    expect(result.keys[0]).toEqual({
      currency0: TOKEN,
      currency1: WETH,
      fee: 0x800000,
      tickSpacing: 200,
      hooks: HOOK
    });
    expect(JSON.parse(store.rows.get(v4TokenMetaKey(TOKEN))!)).toMatchObject({
      token: TOKEN,
      complete: true,
      indexedThrough: Number(head - 5n)
    });
    expect(store.delete).toHaveBeenCalledWith(`orchestrator:pools:${TOKEN}`);
  });

  it('returns discovered keys but marks a partial cursor incomplete', async () => {
    const store = memoryStore({
      [v4TokenMetaKey(TOKEN)]: meta({ complete: false }),
      [v4PoolIndexKey(TOKEN)]: [{
        currency0: TOKEN,
        currency1: WETH,
        fee: 0x800000,
        tickSpacing: 200,
        hooks: HOOK
      }]
    });
    const read = await readIndexedV4PoolKeys(store, TOKEN, 1_001_000);
    expect(read.keys).toHaveLength(1);
    expect(read.complete).toBe(false);
  });

  it('does not call a stale complete index complete coverage', async () => {
    const store = memoryStore({ [v4TokenMetaKey(TOKEN)]: meta() });
    const read = await readIndexedV4PoolKeys(store, TOKEN, 1_000_000 + 60 * 60 * 1000 + 1);
    expect(read.complete).toBe(false);
  });

  it('scheduled catch-up advances the oldest demanded token', async () => {
    const store = memoryStore({
      [v4TokenMetaKey(TOKEN)]: meta({ complete: false, updatedAt: 100 })
    });
    const rpc = {
      getBlockNumber: vi.fn(async () => UNISWAP_V4_START_BLOCK + 500n),
      getLogs: vi.fn(async () => [])
    } as any;

    const result = await syncDemandedV4PoolIndexes(store, rpc, 2_000_000);
    expect(result?.meta.token).toBe(TOKEN);
    expect(result?.complete).toBe(true);
  });
});
