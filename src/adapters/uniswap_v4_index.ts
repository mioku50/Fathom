import { encodeAbiParameters, keccak256, type Address } from 'viem';
import type { PoolInfo } from '../dex_adapter';
import type { PriceRpcClient } from '../utils/price_rpc';

export const UNISWAP_V4_POOL_MANAGER: Address =
  '0x498581ff718922c3f8e6a244956af099b2652b2b';

/** Official Base start block from Uniswap/v4-subgraph networks.json. */
export const UNISWAP_V4_START_BLOCK = 25_350_988n;

/** A v4 PoolKey uses this value to ask its hook for the LP fee at swap time. */
export const V4_DYNAMIC_FEE_FLAG = 0x800000;

export const V4_TOKEN_META_PREFIX = 'v4:index:token:';
const V4_INDEX_MAX_AGE_MS = 60 * 60 * 1000;
const V4_INDEX_CONFIRMATIONS = 5n;
const V4_REQUEST_BLOCKS = 10_000n;
const V4_LOG_CHUNK_BLOCKS = 10_000n;
const V4_CRON_BLOCKS = 200_000n;

export const UNISWAP_V4_INITIALIZE_EVENT = {
  anonymous: false,
  type: 'event',
  name: 'Initialize',
  inputs: [
    { indexed: true, name: 'id', type: 'bytes32' },
    { indexed: true, name: 'currency0', type: 'address' },
    { indexed: true, name: 'currency1', type: 'address' },
    { indexed: false, name: 'fee', type: 'uint24' },
    { indexed: false, name: 'tickSpacing', type: 'int24' },
    { indexed: false, name: 'hooks', type: 'address' },
    { indexed: false, name: 'sqrtPriceX96', type: 'uint160' },
    { indexed: false, name: 'tick', type: 'int24' }
  ]
} as const;

export type V4PoolKey = NonNullable<PoolInfo['v4Key']>;

/** One cursor per requested token avoids materialising every spam pool on Base. */
export type V4TokenIndexMeta = {
  chainId: 8453;
  poolManager: string;
  token: string;
  startBlock: number;
  indexedThrough: number;
  complete: boolean;
  updatedAt: number;
};

/** The subset of Workers KV used by discovery and the scheduled indexer. */
export interface V4PoolIndexStore {
  get(key: string, type?: 'text' | 'json'): Promise<any>;
  put(key: string, value: string, options?: unknown): Promise<void>;
  delete?(key: string): Promise<void>;
  list?(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    cursor?: string;
    list_complete?: boolean;
  }>;
}

export function v4PoolIndexKey(token: string): string {
  return `v4:pools:${token.toLowerCase()}`;
}

export function v4TokenMetaKey(token: string): string {
  return `${V4_TOKEN_META_PREFIX}${token.toLowerCase()}`;
}

export function v4PoolId(key: V4PoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [
        key.currency0 as Address,
        key.currency1 as Address,
        key.fee,
        key.tickSpacing,
        key.hooks as Address
      ]
    )
  );
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isV4PoolKey(value: unknown): value is V4PoolKey {
  const key = value as Partial<V4PoolKey> | null;
  return !!key &&
    isAddress(key.currency0) &&
    isAddress(key.currency1) &&
    Number.isInteger(key.fee) && key.fee! >= 0 && key.fee! <= 0xffffff &&
    Number.isInteger(key.tickSpacing) &&
    isAddress(key.hooks);
}

export function mergeV4PoolKeys(current: V4PoolKey[], incoming: V4PoolKey[]): V4PoolKey[] {
  const byId = new Map<string, V4PoolKey>();
  for (const key of [...current, ...incoming]) {
    if (!isV4PoolKey(key)) continue;
    byId.set(v4PoolId(key), {
      currency0: key.currency0.toLowerCase(),
      currency1: key.currency1.toLowerCase(),
      fee: key.fee,
      tickSpacing: key.tickSpacing,
      hooks: key.hooks.toLowerCase()
    });
  }
  return [...byId.values()];
}

function tokenMeta(value: unknown, token: string): V4TokenIndexMeta | null {
  const meta = value as Partial<V4TokenIndexMeta> | null;
  if (!meta || meta.chainId !== 8453) return null;
  if (meta.poolManager?.toLowerCase() !== UNISWAP_V4_POOL_MANAGER.toLowerCase()) return null;
  if (meta.token?.toLowerCase() !== token.toLowerCase()) return null;
  if (!Number.isInteger(meta.startBlock) || !Number.isInteger(meta.indexedThrough)) return null;
  if (typeof meta.updatedAt !== 'number' || typeof meta.complete !== 'boolean') return null;
  return meta as V4TokenIndexMeta;
}

async function readKeys(store: V4PoolIndexStore, token: string): Promise<V4PoolKey[]> {
  const raw = await store.get(v4PoolIndexKey(token), 'json');
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('Uniswap v4 event index contains an invalid pool list');
  return mergeV4PoolKeys([], raw.filter(isV4PoolKey));
}

export type V4PoolIndexRead = {
  keys: V4PoolKey[];
  complete: boolean;
  meta: V4TokenIndexMeta;
};

/**
 * Read a token-specific cursor. A stale or backfilling cursor remains useful
 * for its already discovered pools, but is explicitly not complete coverage.
 */
export async function readIndexedV4PoolKeys(
  store: V4PoolIndexStore,
  token: string,
  now: number = Date.now()
): Promise<V4PoolIndexRead> {
  const [rawMeta, keys] = await Promise.all([
    store.get(v4TokenMetaKey(token), 'json'),
    readKeys(store, token)
  ]);
  const meta = tokenMeta(rawMeta, token);
  if (!meta) throw new Error('Uniswap v4 token index has not been initialized');
  return {
    keys,
    complete: meta.complete && now - meta.updatedAt <= V4_INDEX_MAX_AGE_MS,
    meta
  };
}

/** Locate contract deployment with archive eth_getCode in O(log block count). */
export async function findContractStartBlock(
  rpc: PriceRpcClient,
  token: Address,
  head: bigint
): Promise<bigint> {
  const atStart = await rpc.getBytecode(token, UNISWAP_V4_START_BLOCK);
  if (atStart && atStart !== '0x') return UNISWAP_V4_START_BLOCK;

  const atHead = await rpc.getBytecode(token, head);
  if (!atHead || atHead === '0x') {
    throw new Error(`No contract bytecode found for ${token}`);
  }

  let absent = UNISWAP_V4_START_BLOCK;
  let present = head;
  while (present - absent > 1n) {
    const middle = (absent + present) / 2n;
    const code = await rpc.getBytecode(token, middle);
    if (code && code !== '0x') present = middle;
    else absent = middle;
  }
  return present;
}

function keyFromLog(log: any): V4PoolKey {
  const args = log?.args;
  const key: V4PoolKey = {
    currency0: args?.currency0,
    currency1: args?.currency1,
    fee: Number(args?.fee),
    tickSpacing: Number(args?.tickSpacing),
    hooks: args?.hooks
  };
  if (!isV4PoolKey(key)) throw new Error('PoolManager returned an invalid Initialize event');
  return key;
}

async function logsForToken(
  rpc: PriceRpcClient,
  token: Address,
  fromBlock: bigint,
  toBlock: bigint,
  chunkBlocks: bigint
): Promise<V4PoolKey[]> {
  const ranges: Array<[bigint, bigint]> = [];
  for (let from = fromBlock; from <= toBlock; from += chunkBlocks) {
    const to = from + chunkBlocks - 1n < toBlock ? from + chunkBlocks - 1n : toBlock;
    ranges.push([from, to]);
  }

  const keys: V4PoolKey[] = [];
  // Four ranges at once keeps latency down without turning a launch burst into
  // an RPC-rate-limit burst. Each range needs one query per indexed currency.
  for (let i = 0; i < ranges.length; i += 4) {
    const batches = await Promise.all(ranges.slice(i, i + 4).map(async ([from, to]) => {
      const [asCurrency0, asCurrency1] = await Promise.all([
        rpc.getLogs({
          address: UNISWAP_V4_POOL_MANAGER,
          event: UNISWAP_V4_INITIALIZE_EVENT,
          args: { currency0: token },
          fromBlock: from,
          toBlock: to,
          strict: true
        }),
        rpc.getLogs({
          address: UNISWAP_V4_POOL_MANAGER,
          event: UNISWAP_V4_INITIALIZE_EVENT,
          args: { currency1: token },
          fromBlock: from,
          toBlock: to,
          strict: true
        })
      ]);
      return [...asCurrency0, ...asCurrency1].map(keyFromLog);
    }));
    keys.push(...batches.flat());
  }
  return mergeV4PoolKeys([], keys);
}

async function writeKeys(
  store: V4PoolIndexStore,
  token: string,
  current: V4PoolKey[],
  incoming: V4PoolKey[]
): Promise<V4PoolKey[]> {
  const merged = mergeV4PoolKeys(current, incoming);
  if (merged.length === current.length) return current;

  await store.put(v4PoolIndexKey(token), JSON.stringify(merged));
  if (store.delete) {
    await Promise.all([
      store.delete(`orchestrator:pools:${token.toLowerCase()}`),
      store.delete(`price:base:${token.toLowerCase()}`)
    ]);
  }
  return merged;
}

export type V4IndexSyncResult = V4PoolIndexRead & {
  fromBlock: number | null;
  toBlock: number;
  logs: number;
};

/**
 * Advance one requested token's immutable Initialize-event cursor. Pool rows
 * are committed before the cursor, so an interrupted write is replay-safe.
 */
export async function syncTokenV4PoolIndex(
  store: V4PoolIndexStore,
  rpc: PriceRpcClient,
  token: string,
  now: number = Date.now(),
  maxBlocks: bigint = V4_REQUEST_BLOCKS,
  chunkBlocks: bigint = V4_LOG_CHUNK_BLOCKS
): Promise<V4IndexSyncResult> {
  if (!isAddress(token)) throw new Error(`Invalid token address: ${token}`);
  const lowerToken = token.toLowerCase();
  const rawMeta = await store.get(v4TokenMetaKey(lowerToken), 'json');
  const previous = tokenMeta(rawMeta, lowerToken);

  if (previous?.complete && now - previous.updatedAt <= V4_INDEX_MAX_AGE_MS) {
    const keys = await readKeys(store, lowerToken);
    return {
      keys,
      complete: true,
      meta: previous,
      fromBlock: null,
      toBlock: previous.indexedThrough,
      logs: 0
    };
  }

  const head = await rpc.getBlockNumber();
  const target = head > V4_INDEX_CONFIRMATIONS ? head - V4_INDEX_CONFIRMATIONS : head;
  const start = previous
    ? BigInt(previous.startBlock)
    : await findContractStartBlock(rpc, lowerToken as Address, target);
  const indexedThrough = previous ? BigInt(previous.indexedThrough) : start - 1n;
  const current = await readKeys(store, lowerToken);

  if (indexedThrough >= target) {
    const meta: V4TokenIndexMeta = {
      chainId: 8453,
      poolManager: UNISWAP_V4_POOL_MANAGER,
      token: lowerToken,
      startBlock: Number(start),
      indexedThrough: Number(indexedThrough),
      complete: true,
      updatedAt: now
    };
    await store.put(v4TokenMetaKey(lowerToken), JSON.stringify(meta));
    return { keys: current, complete: true, meta, fromBlock: null, toBlock: Number(indexedThrough), logs: 0 };
  }

  const fromBlock = indexedThrough + 1n;
  const toBlock = fromBlock + maxBlocks - 1n < target ? fromBlock + maxBlocks - 1n : target;
  const incoming = await logsForToken(
    rpc,
    lowerToken as Address,
    fromBlock,
    toBlock,
    chunkBlocks
  );
  const keys = await writeKeys(store, lowerToken, current, incoming);
  const complete = toBlock >= target;
  const meta: V4TokenIndexMeta = {
    chainId: 8453,
    poolManager: UNISWAP_V4_POOL_MANAGER,
    token: lowerToken,
    startBlock: Number(start),
    indexedThrough: Number(toBlock),
    complete,
    updatedAt: now
  };
  await store.put(v4TokenMetaKey(lowerToken), JSON.stringify(meta));

  return {
    keys,
    complete,
    meta,
    fromBlock: Number(fromBlock),
    toBlock: Number(toBlock),
    logs: incoming.length
  };
}

/** Advance the oldest demanded token on each 15-minute scheduled run. */
export async function syncDemandedV4PoolIndexes(
  store: V4PoolIndexStore,
  rpc: PriceRpcClient,
  now: number = Date.now()
): Promise<V4IndexSyncResult | null> {
  if (!store.list) return null;
  const listed = await store.list({ prefix: V4_TOKEN_META_PREFIX, limit: 50 });
  const metas = (await Promise.all(listed.keys.map(async ({ name }) => {
    const token = name.slice(V4_TOKEN_META_PREFIX.length);
    return tokenMeta(await store.get(name, 'json'), token);
  }))).filter((meta): meta is V4TokenIndexMeta => !!meta);

  const candidate = metas
    .filter(meta => !meta.complete || now - meta.updatedAt > V4_INDEX_MAX_AGE_MS)
    .sort((a, b) => a.updatedAt - b.updatedAt)[0];
  if (!candidate) return null;

  return syncTokenV4PoolIndex(
    store,
    rpc,
    candidate.token,
    now,
    V4_CRON_BLOCKS,
    V4_LOG_CHUNK_BLOCKS
  );
}
