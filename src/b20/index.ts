/**
 * The B20 layer: asset semantics and stock reference context, wrapped around a
 * DEX measurement that this module does not touch.
 */

import { detectAssetType, readB20State, type B20RpcClient } from './reader';
import { readStockReference } from './reference';
import type { B20Context } from './types';
import { PLAIN_ERC20 } from './types';

export * from './types';
export { PREMIUM_NOTABLE_BPS } from './reference';
export { VERIFIED_COINBASE_STOCKS, verifiedStockFor } from './constants';
export type { B20RpcClient } from './reader';

/**
 * Everything Fathom can say about a token beyond its market.
 *
 * Returns `PLAIN_ERC20` for anything that is not a B20 token, which is the
 * overwhelming majority and the path that must stay exactly as it was. The two
 * reads for a B20 token run together, so the whole layer costs one round trip
 * of latency on top of pricing.
 */
export async function readB20Context(
  rpc: B20RpcClient,
  token: string,
  measuredPriceUsd: number | null,
  nowSeconds?: number
): Promise<B20Context> {
  const { assetType } = await detectAssetType(rpc, token);
  if (assetType === 'erc20') return PLAIN_ERC20;

  const [state, reference] = await Promise.all([
    readB20State(rpc, token, assetType),
    readStockReference(rpc, token, measuredPriceUsd, nowSeconds)
  ]);

  return {
    asset_type: assetType,
    b20: state.state,
    stock_reference: assetType === 'b20_stock' ? reference.reference : null,
    flags: ['b20_asset', ...state.flags, ...reference.flags]
  };
}
