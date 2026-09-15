/**
 * Reads a token's B20 asset semantics.
 *
 * This layer never prices anything. The DEX engine remains the only source of
 * an executable number; everything here is context wrapped around it, and every
 * field it cannot establish comes back `null` rather than defaulted.
 */

import {
  B20_ASSET_ABI,
  B20_FACTORY,
  B20_FACTORY_ABI,
  COINBASE_ORACLE_REGISTRY,
  ORACLE_REGISTRY_READ_SELECTOR,
  PAUSABLE_TRANSFER,
  TRANSFER_EXECUTOR_POLICY,
  TRANSFER_SENDER_POLICY,
  WAD,
  verifiedStockFor
} from './constants';
import type { AssetType, B20Context, B20State } from './types';
import { PLAIN_ERC20 } from './types';

/** The subset of the RPC client this module needs, so tests can supply two functions. */
export interface B20RpcClient {
  multicall(args: any): Promise<any[]>;
  client?: { call?: (args: any) => Promise<{ data?: string }> };
}

function ok<T = any>(entry: any): T | null {
  return entry && entry.status === 'success' ? (entry.result as T) : null;
}

/** WAD-scaled bigint to a number. Multipliers sit near 1.0, so this is exact enough. */
function fromWad(value: bigint | null): number | null {
  if (value === null || typeof value !== 'bigint') return null;
  return Number((value * 1_000_000n) / WAD) / 1_000_000;
}

/**
 * Is this a B20 token, and is it one of the Coinbase tokenized stocks?
 *
 * Detection goes through the factory's own `isB20`, never through bytecode:
 * B20 tokens are native precompiles and hold no code at all, so any probe
 * shaped like "does this address have a contract" answers no for every one of
 * them. Symbol and name are no good either — both are mutable on chain by the
 * issuer.
 */
export async function detectAssetType(
  rpc: B20RpcClient,
  token: string
): Promise<{ assetType: AssetType; initialized: boolean | null }> {
  let results: any[];
  try {
    results = await rpc.multicall({
      allowFailure: true,
      contracts: [
        { address: B20_FACTORY, abi: B20_FACTORY_ABI, functionName: 'isB20', args: [token] },
        { address: B20_FACTORY, abi: B20_FACTORY_ABI, functionName: 'isB20Initialized', args: [token] }
      ]
    });
  } catch {
    // The factory being unreachable says nothing about the token. Treat it as
    // an ordinary ERC-20 and let the caller's own flags carry the gap.
    return { assetType: 'erc20', initialized: null };
  }

  const isB20 = ok<boolean>(results[0]);
  const initialized = ok<boolean>(results[1]);

  if (isB20 !== true) return { assetType: 'erc20', initialized: null };

  return {
    assetType: verifiedStockFor(token) ? 'b20_stock' : 'b20_asset',
    initialized: initialized ?? null
  };
}

/**
 * Reads the registry Coinbase's own Chainlink feeds consult, by raw selector.
 *
 * Its ABI is unpublished, so the decode is checked against a value we already
 * hold from a documented source: the token's own `multiplier()`. If the two
 * disagree the decode is not to be trusted, and the pause flag beside it is
 * discarded rather than reported. An undocumented interface is allowed to
 * change; what is not allowed is for that change to turn into a confident
 * `corporate_action_pending: false`.
 */
async function readOracleRegistryPause(
  rpc: B20RpcClient,
  token: string,
  tokenMultiplierWad: bigint | null
): Promise<boolean | null> {
  const call = rpc.client?.call;
  if (!call || tokenMultiplierWad === null) return null;

  let data: string | undefined;
  try {
    const padded = token.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const res = await call({
      to: COINBASE_ORACLE_REGISTRY,
      data: `${ORACLE_REGISTRY_READ_SELECTOR}${padded}`
    });
    data = res?.data;
  } catch {
    return null;
  }

  if (typeof data !== 'string') return null;
  const body = data.replace(/^0x/, '');
  if (body.length < 128) return null;

  let registryMultiplier: bigint;
  let paused: bigint;
  try {
    registryMultiplier = BigInt(`0x${body.slice(0, 64)}`);
    paused = BigInt(`0x${body.slice(64, 128)}`);
  } catch {
    return null;
  }

  if (registryMultiplier !== tokenMultiplierWad) return null;
  if (paused !== 0n && paused !== 1n) return null;

  return paused === 1n;
}

/**
 * Reads the asset-semantics half of a B20 assessment.
 *
 * The ERC-8056 scheduled-multiplier views (`uiMultiplier`, `newUIMultiplier`,
 * `effectiveAt`) are requested but revert on every Coinbase tokenized stock as
 * deployed today; they are specified, not yet live. A revert therefore leaves
 * them `null` and adds `b20_scheduled_update_unverified`, because reporting
 * "no corporate action scheduled" on the strength of a function that does not
 * exist is exactly the kind of invented certainty this service refuses.
 */
export async function readB20State(
  rpc: B20RpcClient,
  token: string,
  assetType: AssetType
): Promise<{ state: B20State; flags: string[] }> {
  const flags: string[] = [];
  const asset = { address: token as `0x${string}`, abi: B20_ASSET_ABI };

  let results: any[] = [];
  try {
    results = await rpc.multicall({
      allowFailure: true,
      contracts: [
        { ...asset, functionName: 'multiplier' },
        { ...asset, functionName: 'uiMultiplier' },
        { ...asset, functionName: 'newUIMultiplier' },
        { ...asset, functionName: 'effectiveAt' },
        { ...asset, functionName: 'isPaused', args: [PAUSABLE_TRANSFER] },
        { ...asset, functionName: 'policyId', args: [TRANSFER_SENDER_POLICY] },
        { ...asset, functionName: 'policyId', args: [TRANSFER_EXECUTOR_POLICY] }
      ]
    });
  } catch {
    flags.push('b20_metadata_unverified');
  }

  const multiplierWad = ok<bigint>(results[0]);
  const uiMultiplierWad = ok<bigint>(results[1]);
  const nextMultiplierWad = ok<bigint>(results[2]);
  const effectiveAtRaw = ok<bigint>(results[3]);
  const paused = ok<boolean>(results[4]);
  const senderPolicy = ok<bigint>(results[5]);
  const executorPolicy = ok<bigint>(results[6]);

  if (multiplierWad === null && !flags.includes('b20_metadata_unverified')) {
    flags.push('b20_metadata_unverified');
  }
  if (uiMultiplierWad === null) flags.push('b20_scheduled_update_unverified');

  // Policy id 0 is the built-in always-allow. Anything else means a policy is
  // configured, which is not the same as this caller being blocked by it.
  const policyKnown = senderPolicy !== null || executorPolicy !== null;
  const policyRestricted = policyKnown
    ? (senderPolicy ?? 0n) !== 0n || (executorPolicy ?? 0n) !== 0n
    : null;
  // Both "a policy is configured" and "we could not read one" are gaps in what
  // we know, not findings against the token: neither says this seller is blocked.
  if (policyRestricted !== false) flags.push('b20_policy_unverified');

  const corporateActionPending = await readOracleRegistryPause(rpc, token, multiplierWad);
  if (corporateActionPending === null) flags.push('corporate_action_unverified');
  if (corporateActionPending === true) flags.push('corporate_action_pending');

  if (paused === true) flags.push('b20_transfer_paused');

  const stock = assetType === 'b20_stock' ? verifiedStockFor(token) : null;

  return {
    state: {
      underlying: stock?.underlying ?? null,
      multiplier: fromWad(multiplierWad),
      ui_multiplier: fromWad(uiMultiplierWad),
      next_ui_multiplier: fromWad(nextMultiplierWad),
      effective_at:
        effectiveAtRaw !== null && effectiveAtRaw > 0n
          ? new Date(Number(effectiveAtRaw) * 1000).toISOString()
          : null,
      corporate_action_pending: corporateActionPending,
      paused,
      policy_restricted: policyRestricted
    },
    flags
  };
}

export { PLAIN_ERC20 };
