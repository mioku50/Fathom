import { Address } from 'viem';
import { PriceRpcClient } from '../utils/price_rpc';
import type { TwapRequest, TwapResult } from '../dex_adapter';

/**
 * TWAP for concentrated-liquidity pools (Uniswap V3 and Aerodrome Slipstream),
 * which share the `observe(uint32[])` oracle.
 *
 * `observe` returns cumulative ticks; the average tick over the window is the
 * difference divided by its length, and 1.0001^tick is the raw token1/token0
 * price. Reverts when the pool has not stored enough observations - cardinality
 * is 1 by default - and that is reported as null rather than papered over.
 */
export async function readConcentratedTwap(
  client: PriceRpcClient,
  request: TwapRequest,
  pinBlock?: bigint
): Promise<TwapResult | null> {
  const abi = [
    {
      inputs: [{ internalType: 'uint32[]', name: 'secondsAgos', type: 'uint32[]' }],
      name: 'observe',
      outputs: [
        { internalType: 'int56[]', name: 'tickCumulatives', type: 'int56[]' },
        { internalType: 'uint160[]', name: 'secondsPerLiquidityCumulativeX128', type: 'uint160[]' }
      ],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [],
      name: 'token0',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      stateMutability: 'view',
      type: 'function'
    }
  ] as const;

  const window = Math.floor(request.windowSeconds);
  if (!Number.isFinite(window) || window <= 0) return null;

  const results = await client.multicall({
    contracts: [
      {
        address: request.pool.address as Address,
        abi,
        functionName: 'observe',
        args: [[window, 0]]
      },
      {
        address: request.pool.address as Address,
        abi,
        functionName: 'token0'
      }
    ],
    allowFailure: true,
    blockNumber: pinBlock
  });

  const observed: any = results[0];
  const token0: any = results[1];
  if (observed?.status !== 'success' || token0?.status !== 'success') return null;

  const cumulatives = observed.result?.[0];
  if (!Array.isArray(cumulatives) || cumulatives.length < 2) return null;

  // observe() returns oldest-first: index 0 is `window` seconds ago.
  const delta = BigInt(cumulatives[1]) - BigInt(cumulatives[0]);
  const averageTick = Number(delta / BigInt(window));
  if (!Number.isFinite(averageTick)) return null;

  // A tick encodes the raw token1-per-token0 price, decimals included.
  const token1PerToken0 = Math.pow(1.0001, averageTick);
  if (!Number.isFinite(token1PerToken0) || token1PerToken0 <= 0) return null;

  const inIsToken0 = String(token0.result).toLowerCase() === request.tokenIn.toLowerCase();
  const ratio = inIsToken0 ? token1PerToken0 : 1 / token1PerToken0;

  const amountOut = Number(request.amountIn) * ratio;
  if (!Number.isFinite(amountOut) || amountOut <= 0) return null;

  return { amountOut: BigInt(Math.floor(amountOut)), windowSeconds: window };
}
