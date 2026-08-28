export interface PoolInfo {
  address: string;
  dex: string;
  fee?: number;
  /**
   * True for Aerodrome stable pools, which use the x3y+y3x curve rather than
   * constant product. Depth math must not treat them as x*y=k.
   */
  stable?: boolean;
  /** Slipstream pools are keyed by tick spacing rather than a fee tier. */
  tickSpacing?: number;
  /**
   * Uniswap v4 pools live inside one singleton and have no address of their
   * own, only a PoolId derived from this key. `address` carries the PoolId, and
   * the key is kept because keccak cannot be reversed - and because PoolInfo is
   * cached, so it must survive a round trip through storage.
   */
  v4Key?: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
}

export interface RawPoolData {
  reserve0?: bigint;
  reserve1?: bigint;
  liquidity?: bigint;
  sqrtPriceX96?: bigint;
  tick?: number;
  token0?: string;
  token1?: string;
  updatedAt: number;
}

/** A time-averaged price read from a pool's own oracle. */
export interface TwapRequest {
  pool: PoolInfo;
  tokenIn: string;
  tokenOut: string;
  /** Size to price, in token-in raw units. */
  amountIn: bigint;
  /** Desired averaging window. Adapters report the window they actually used. */
  windowSeconds: number;
}

export interface TwapResult {
  /** Time-averaged output for `amountIn`, in token-out raw units. */
  amountOut: bigint;
  /** The window actually averaged over, which may differ from the request. */
  windowSeconds: number;
}

/** One exact sell simulated on-chain: `amountOut` in quote-token raw units. */
export interface SellQuoteRequest {
  pool: PoolInfo;
  tokenIn: string;
  tokenOut: string;
  /** Sizes to quote, in token-in raw units. */
  amountsIn: bigint[];
}

export interface DEXAdapter {
  readonly id: string;

  /**
   * Discover all relevant pools for a token.
   * @param tokenAddress The ERC-20 token contract address (0x...).
   * @returns A promise that resolves to an array of PoolInfo objects.
   */
  getPools(tokenAddress: string): Promise<PoolInfo[]>;

  /**
   * Fetch reserves, ticks, or state for price/liquidity calculation.
   * @param poolAddress The pool contract's address, or its PoolId on Uniswap v4.
   * @param pool The PoolInfo it came from. Uniswap v4 pools have no per-pool
   *   contract to query for their currencies, so the key travels with them.
   */
  getRawData(poolAddress: string, pool?: PoolInfo): Promise<RawPoolData>;

  /**
   * Optional: ask the DEX itself what a sell would return, so curves we cannot
   * solve in closed form (concentrated liquidity, Aerodrome's stable curve) are
   * quoted exactly instead of approximated.
   *
   * Returns one entry per requested size, `null` where that size could not be
   * quoted (typically insufficient liquidity).
   */
  quoteSell?(request: SellQuoteRequest): Promise<(bigint | null)[]>;

  /**
   * Optional: read the pool's own time-weighted average price.
   *
   * Returns null when the pool cannot answer - most often because its
   * observation cardinality is 1, which is the default for a freshly created
   * pool and therefore common on exactly the long-tail tokens Fathom prices.
   * That is a real "not available", not a reason to substitute spot.
   */
  getTwapAmountOut?(request: TwapRequest): Promise<TwapResult | null>;
}
