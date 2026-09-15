/**
 * What Fathom can say about a token's asset semantics, kept deliberately
 * separate from what it says about the token's market.
 */

/**
 * Three values, not the two the obvious design would have.
 *
 * The B20 factory is permissionless, so "this is a B20 asset" and "this is a
 * Coinbase tokenized stock" are different claims, and only the second one
 * licenses comparing the token against an equity reference price. A B20 asset
 * we cannot identify gets `b20_asset`: we read its multiplier and pause state,
 * and we say nothing about what it represents.
 */
export type AssetType = 'erc20' | 'b20_asset' | 'b20_stock';

export type B20State = {
  /** The equity this token represents, for verified stocks only. */
  underlying: string | null;

  /**
   * The live redemption ratio, WAD-decoded. One token is redeemable for this
   * many shares, so it is not 1.0 forever: dividends and splits move it.
   * `null` if the read failed — never defaulted to 1.0, because assuming the
   * identity multiplier silently misprices every token that has ever paid a
   * dividend.
   */
  multiplier: number | null;

  /**
   * ERC-8056 scheduled-update view. `null` means the token does not implement
   * it — which is the case for every Coinbase tokenized stock today — and not
   * that no update is scheduled.
   */
  ui_multiplier: number | null;
  next_ui_multiplier: number | null;
  effective_at: string | null;

  /**
   * True while Coinbase's oracle registry holds the feed frozen to apply a
   * corporate action. `null` when the registry could not be read or its answer
   * failed its cross-check, because "we could not look" is not "nothing is
   * pending".
   */
  corporate_action_pending: boolean | null;

  /** Transfers paused on chain. This blocks a sale outright. */
  paused: boolean | null;

  /**
   * A non-zero transfer policy is configured. It does NOT mean this caller is
   * blocked: secondary trading is permissionless and these slots normally hold
   * a sanctions blocklist. Whether any particular address is authorised cannot
   * be answered without knowing the address, which Fathom does not.
   */
  policy_restricted: boolean | null;
};

export type StockReference = {
  /**
   * The Chainlink total-return value: the price of one token, already inclusive
   * of the multiplier. Not the price of one underlying share.
   */
  reference_price_usd: number | null;
  /** Fathom's measured on-chain price against that reference, in bps. */
  premium_discount_bps: number | null;
  source: 'chainlink' | null;
  feed: string | null;
  updated_at: string | null;
  /** How long the feed has been holding its value. */
  age_seconds: number | null;
};

export type B20Context = {
  asset_type: AssetType;
  b20: B20State | null;
  stock_reference: StockReference | null;
  /** Flag names for the assessment layer to translate. */
  flags: string[];
};

/** Plain ERC-20: the answer Fathom has always given, unchanged. */
export const PLAIN_ERC20: B20Context = {
  asset_type: 'erc20',
  b20: null,
  stock_reference: null,
  flags: []
};
