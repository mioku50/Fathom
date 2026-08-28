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
   * @param poolAddress The address of the pool contract.
   * @returns A promise that resolves to the raw data of the pool.
   */
  getRawData(poolAddress: string): Promise<RawPoolData>;

  /**
   * Optional: ask the DEX itself what a sell would return, so curves we cannot
   * solve in closed form (concentrated liquidity, Aerodrome's stable curve) are
   * quoted exactly instead of approximated.
   *
   * Returns one entry per requested size, `null` where that size could not be
   * quoted (typically insufficient liquidity).
   */
  quoteSell?(request: SellQuoteRequest): Promise<(bigint | null)[]>;
}
