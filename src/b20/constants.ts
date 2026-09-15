/**
 * B20 is Base's native token standard for real-world assets, and Coinbase's
 * tokenized stocks are its first large deployment. Everything in this file was
 * read off Base mainnet on 2026-09-15 rather than taken from documentation
 * alone, because three of the things the documentation describes are not what
 * the deployed tokens actually do. Those divergences are recorded where they
 * matter.
 *
 * Reference: https://docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks
 */

/** Singleton factory precompile. Identical on every network where B20 is active. */
export const B20_FACTORY = '0xB20f000000000000000000000000000000000000' as const;

/**
 * Coinbase's oracle registry: the contract the Chainlink feeds themselves read
 * to get a token's multiplier and freeze flag. Documented as existing; its ABI
 * is not published, so the one function we use is called by raw selector and
 * checksummed against a value we can obtain independently. See `reader.ts`.
 */
export const COINBASE_ORACLE_REGISTRY = '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD' as const;

/**
 * `(uint256 multiplier, bool paused)` keyed by token address.
 *
 * Recovered from the registry's dispatcher and confirmed against all ten live
 * tokenized stocks: every decoded multiplier matched the token's own
 * `multiplier()`, including GOOGLc's 1.000377, and the call reverts for a
 * non-B20 address. The selector is used directly because the function's name —
 * and therefore its ABI entry — is not public.
 */
export const ORACLE_REGISTRY_READ_SELECTOR = '0xd4197e82' as const;

/** `PausableFeature` ordinals. Append-only; TRANSFER is the one that blocks a sale. */
export const PAUSABLE_TRANSFER = 0;

/** Multipliers are WAD-scaled: 1e18 is 1.0. Confirmed by `WAD_PRECISION()`. */
export const WAD = 10n ** 18n;

/**
 * Chainlink feeds report **total return**, which is the underlying's price
 * already multiplied by the token's multiplier — that is, the price of one
 * token, not the price of one share. Applying the multiplier to this value a
 * second time would double-count every corporate action ever applied.
 */
export const REFERENCE_FEED_DECIMALS = 8;

/**
 * The feed's documented heartbeat during market hours. Outside them it stops
 * updating and holds the last value by design, so age beyond this bound means
 * "the market is closed", not "the feed is broken" — which is why it never
 * produces a concern.
 */
export const REFERENCE_HEARTBEAT_SECONDS = 24 * 60 * 60;

/**
 * The Coinbase tokenized stocks, with the Chainlink feed for each.
 *
 * Being a B20 asset does not make a token a Coinbase tokenized stock: the
 * factory is permissionless. This list is what lets Fathom say "stock" about a
 * token instead of guessing from a ticker that the issuer can rename on chain.
 */
export type VerifiedStock = {
  /** Token address, lowercased for lookup. */
  readonly token: string;
  /** The equity this token represents. */
  readonly underlying: string;
  /** Chainlink V3 aggregator proxy on Base. */
  readonly feed: string;
};

export const VERIFIED_COINBASE_STOCKS: readonly VerifiedStock[] = [
  { token: '0xb200000000000000000000c2e324d24d7eecd1fb', underlying: 'AAPL',  feed: '0x787f13dEa48Db0897CbCDD985de77809D837F988' },
  { token: '0xb200000000000000000000d9192b6b456483c2e8', underlying: 'AMZN',  feed: '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295' },
  { token: '0xb2000000000000000000002d0ba3164cc74f58b7', underlying: 'GOOGL', feed: '0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2' },
  { token: '0xb2000000000000000000008bc8786b856e61707c', underlying: 'META',  feed: '0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D' },
  { token: '0xb200000000000000000000ab99cfa739e253872b', underlying: 'MSFT',  feed: '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c' },
  { token: '0xb2000000000000000000004884b426556b92883d', underlying: 'MSTR',  feed: '0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a' },
  { token: '0xb20000000000000000000078ee7ce2fe4908108c', underlying: 'NVDA',  feed: '0x04689a41629776563E6822F76f2e57D148d28513' },
  { token: '0xb200000000000000000000397293cb8cda9a10c5', underlying: 'SNDK',  feed: '0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA' },
  { token: '0xb2000000000000000000007b9fcbd005511acbd5', underlying: 'SPCX',  feed: '0x6A634B235903C4ad6376892180d6fF8612e3Fa68' },
  { token: '0xb2000000000000000000001e800a7f5189430cd0', underlying: 'TSLA',  feed: '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4' }
];

const STOCKS_BY_TOKEN = new Map(VERIFIED_COINBASE_STOCKS.map(s => [s.token, s]));

export function verifiedStockFor(token: string): VerifiedStock | null {
  return STOCKS_BY_TOKEN.get(token.toLowerCase()) ?? null;
}

export const B20_FACTORY_ABI = [
  { name: 'isB20', type: 'function', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'isB20Initialized', type: 'function', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }], outputs: [{ type: 'bool' }] }
] as const;

/**
 * Policy scope keys, which are plain `keccak256` of their names. Verified
 * against the value `TRANSFER_SENDER_POLICY()` returns on chain, so they are
 * computed here rather than read — one fewer round trip per assessment.
 */
export const TRANSFER_SENDER_POLICY = '0xb81736c875ab819dd97f59f2a6542cfb731ad52b4ae15a6f24df2fb02b0327f5' as const;
export const TRANSFER_EXECUTOR_POLICY = '0x10be5173aff2a44e748bd9acd8b19fe34689581398a9db7ba2fb671e786ff7d8' as const;

export const B20_ASSET_ABI = [
  { name: 'multiplier', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'uiMultiplier', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'newUIMultiplier', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'effectiveAt', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { name: 'isPaused', type: 'function', stateMutability: 'view', inputs: [{ name: 'feature', type: 'uint8' }], outputs: [{ type: 'bool' }] },
  { name: 'policyId', type: 'function', stateMutability: 'view', inputs: [{ name: 'policyScope', type: 'bytes32' }], outputs: [{ type: 'uint64' }] },
  { name: 'TRANSFER_SENDER_POLICY', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { name: 'TRANSFER_EXECUTOR_POLICY', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] }
] as const;

export const CHAINLINK_AGGREGATOR_ABI = [
  {
    name: 'latestRoundData', type: 'function', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' }
    ]
  }
] as const;

/**
 * Every flag the B20 layer can emit, in one place so documentation and tests
 * can be checked against it rather than against a second copy that drifts.
 *
 * `stock_premium_high` and `stock_discount_high` are deliberately in neither
 * the concern nor the unverified dictionary: a premium is an observation about
 * price, not a risk and not a gap in what was looked at.
 */
export const B20_FLAGS = [
  'b20_asset',
  'b20_metadata_unverified',
  'b20_scheduled_update_unverified',
  'b20_policy_unverified',
  'b20_transfer_paused',
  'corporate_action_pending',
  'corporate_action_unverified',
  'reference_price_unavailable',
  'reference_price_stale',
  'premium_unverified',
  'stock_premium_high',
  'stock_discount_high'
] as const;
