#!/usr/bin/env node
/**
 * Backfill one token's Uniswap v4 PoolKeys from Base Initialize events and
 * generate a file accepted by `wrangler kv bulk put`.
 *
 * Usage:
 *   node scripts/backfill_uniswap_v4_index.js <token> <output-file> [fromBlock] [toBlock]
 */

const { writeFile } = require('fs/promises');
const { decodeEventLog, encodeAbiParameters, keccak256, pad, toBytes } = require('viem');

const RPC_URL = process.env.V4_INDEX_RPC_URL || 'https://mainnet.base.org';
const POOL_MANAGER = '0x498581ff718922c3f8e6a244956af099b2652b2b';
const START_BLOCK = 25_350_988;
const CONFIRMATIONS = 5;
const BLOCKS_PER_REQUEST = 10_000;
const CONCURRENCY = 4;

const INITIALIZE_EVENT = {
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
};

const INITIALIZE_TOPIC = keccak256(
  toBytes('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)')
);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rpc(method, params) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: `${method}-${attempt}`, method, params })
      });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error?.message || `HTTP ${response.status}`);
      return body.result;
    } catch (error) {
      lastError = error;
      await wait(250 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function findStart(token, head) {
  const codeAtStart = await rpc('eth_getCode', [token, `0x${START_BLOCK.toString(16)}`]);
  if (codeAtStart !== '0x') return START_BLOCK;
  const codeAtHead = await rpc('eth_getCode', [token, `0x${head.toString(16)}`]);
  if (codeAtHead === '0x') throw new Error(`no contract bytecode found for ${token}`);

  let absent = START_BLOCK;
  let present = head;
  while (present - absent > 1) {
    const middle = Math.floor((absent + present) / 2);
    const code = await rpc('eth_getCode', [token, `0x${middle.toString(16)}`]);
    if (code === '0x') absent = middle;
    else present = middle;
  }
  return present;
}

async function logsForRange(tokenTopic, fromBlock, toBlock) {
  const base = {
    address: POOL_MANAGER,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`
  };
  const [currency0, currency1] = await Promise.all([
    rpc('eth_getLogs', [{ ...base, topics: [INITIALIZE_TOPIC, null, tokenTopic] }]),
    rpc('eth_getLogs', [{ ...base, topics: [INITIALIZE_TOPIC, null, null, tokenTopic] }])
  ]);
  return [...currency0, ...currency1];
}

function poolId(key) {
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]
  ));
}

async function main() {
  const token = process.argv[2]?.toLowerCase();
  const outputFile = process.argv[3];
  if (!/^0x[0-9a-f]{40}$/.test(token || '') || !outputFile) {
    throw new Error('usage: node scripts/backfill_uniswap_v4_index.js <token> <output-file> [fromBlock] [toBlock]');
  }

  const head = Number(BigInt(await rpc('eth_blockNumber', [])));
  const fromBlock = process.argv[4] ? Number(process.argv[4]) : await findStart(token, head);
  const toBlock = process.argv[5] ? Number(process.argv[5]) : head - CONFIRMATIONS;
  if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || fromBlock > toBlock) {
    throw new Error(`invalid block range ${fromBlock}..${toBlock}`);
  }

  const ranges = [];
  for (let from = fromBlock; from <= toBlock; from += BLOCKS_PER_REQUEST) {
    ranges.push([from, Math.min(toBlock, from + BLOCKS_PER_REQUEST - 1)]);
  }

  const tokenTopic = pad(token, { size: 32 });
  const pools = new Map();
  let nextRange = 0;
  let completed = 0;

  const worker = async () => {
    while (true) {
      const index = nextRange++;
      if (index >= ranges.length) return;
      const [from, to] = ranges[index];
      const logs = await logsForRange(tokenTopic, from, to);
      for (const log of logs) {
        const { args } = decodeEventLog({
          abi: [INITIALIZE_EVENT],
          data: log.data,
          topics: log.topics,
          strict: true
        });
        const key = {
          currency0: args.currency0.toLowerCase(),
          currency1: args.currency1.toLowerCase(),
          fee: Number(args.fee),
          tickSpacing: Number(args.tickSpacing),
          hooks: args.hooks.toLowerCase()
        };
        pools.set(poolId(key), key);
      }
      completed++;
      if (completed % 50 === 0 || completed === ranges.length) {
        console.log(JSON.stringify({ event: 'progress', completed, total: ranges.length, pools: pools.size }));
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ranges.length) }, worker));
  const entries = [
    { key: `v4:pools:${token}`, value: JSON.stringify([...pools.values()]) },
    {
      key: `v4:index:token:${token}`,
      value: JSON.stringify({
        chainId: 8453,
        poolManager: POOL_MANAGER,
        token,
        startBlock: fromBlock,
        indexedThrough: toBlock,
        complete: true,
        updatedAt: Date.now()
      })
    }
  ];
  await writeFile(outputFile, JSON.stringify(entries));
  console.log(JSON.stringify({ event: 'complete', token, fromBlock, toBlock, pools: pools.size, outputFile }));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
