import { Address } from 'viem';
import { PriceRpcClient } from '../utils/price_rpc';

/**
 * Read the same set of functions across many pools in one multicall.
 *
 * Reading pools one at a time meant one RPC round trip each. A well-covered
 * token sits in 30+ pools, and that burst is what providers throttle - which
 * the engine can only see as "no liquidity", a silent wrong answer rather than
 * a visible failure. Every pool on a given DEX shares an ABI, so they can all
 * travel together.
 *
 * Returns one entry per pool, `null` where any of its reads failed. viem splits
 * oversized batches into several eth_calls on its own.
 */
export async function readPoolsBatch<T>(
  client: PriceRpcClient,
  poolAddresses: string[],
  abi: any,
  functionNames: readonly string[],
  pinBlock?: bigint
): Promise<(any[] | null)[]> {
  if (poolAddresses.length === 0) return [];

  const contracts = poolAddresses.flatMap(address =>
    functionNames.map(functionName => ({
      address: address as Address,
      abi,
      functionName
    }))
  );

  const results = await client.multicall({
    contracts,
    allowFailure: true,
    blockNumber: pinBlock
  });

  const width = functionNames.length;
  return poolAddresses.map((_, i) => {
    const slice = results.slice(i * width, (i + 1) * width) as any[];
    if (slice.length !== width) return null;
    if (slice.some(r => r?.status !== 'success')) return null;
    return slice.map(r => r.result);
  });
}
