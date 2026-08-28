export interface PoolInfo {
  address: string;
  dex: string;
  fee?: number;
  /**
   * True for Aerodrome stable pools, which use the x3y+y3x curve rather than
   * constant product. Depth math must not treat them as x*y=k.
   */
  stable?: boolean;
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
}
