import { Address, keccak256, encodeAbiParameters } from 'viem';
import { DEXAdapter, PoolInfo, RawPoolData, SellQuoteRequest } from '../dex_adapter';
import { PriceRpcClient, isRpcFailure } from '../utils/price_rpc';

/** In v4 the native asset is address(0), not WETH. */
export const NATIVE_ETH = '0x0000000000000000000000000000000000000000';

/**
 * Uniswap v4.
 *
 * Every pool lives inside one PoolManager singleton and is identified by a
 * PoolId - keccak of its PoolKey - rather than by an address, so there is no
 * factory to enumerate and no `getPool` to call. Pools are also permissionless
 * in their hooks, which means the full set cannot be discovered without
 * indexing events.
 *
 * This adapter therefore probes the canonical, hookless keys: the standard
 * fee/tick-spacing pairs against the quote assets Fathom already anchors. Pools
 * behind custom hooks are not found, and that is a stated limit rather than a
 * silent gap - they simply do not contribute to `source_count`.
 */
export class UniswapV4Adapter implements DEXAdapter {
  readonly id = 'uniswap_v4';
  private client: PriceRpcClient;

  // StateView is the read-only lens over the PoolManager's storage.
  private stateViewAddress: Address = '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71';
  private quoterAddress: Address = '0x0d5e0f971ed27fbff6c2837bf31316121532048d';

  /**
   * Native ETH first: on Base the deepest v4 pools are ETH-quoted, not
   * WETH-quoted, and missing them would mean missing most of v4's liquidity.
   */
  private quoteAssets: string[] = [
    NATIVE_ETH,
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0x940181a94a35a4569e4529a3cdfb74e38fd98631'  // AERO
  ];

  /** The fee / tick-spacing pairs Uniswap's own interface creates. */
  private feeTiers: [number, number][] = [
    [100, 1],
    [500, 10],
    [3000, 60],
    [10000, 200]
  ];

  private pinBlock?: bigint;

  constructor(rpcUrl: string, fallbackUrlsStr?: string, pinBlock?: string, sharedClient?: PriceRpcClient) {
    if (pinBlock && pinBlock !== 'latest') {
      this.pinBlock = BigInt(pinBlock);
    }
    this.client = sharedClient ?? new PriceRpcClient(rpcUrl, fallbackUrlsStr);
  }

  /** PoolId = keccak256(abi.encode(PoolKey)). Currencies must be sorted. */
  static poolId(key: NonNullable<PoolInfo['v4Key']>): `0x${string}` {
    return keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
        [key.currency0 as Address, key.currency1 as Address, key.fee, key.tickSpacing, key.hooks as Address]
      )
    );
  }

  private static sortCurrencies(a: string, b: string): [string, string] {
    return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  }

  async getPools(tokenAddress: string): Promise<PoolInfo[]> {
    const candidates: PoolInfo[] = [];
    for (const quoteAsset of this.quoteAssets) {
      if (tokenAddress.toLowerCase() === quoteAsset.toLowerCase()) continue;
      const [currency0, currency1] = UniswapV4Adapter.sortCurrencies(tokenAddress, quoteAsset);
      for (const [fee, tickSpacing] of this.feeTiers) {
        const v4Key = { currency0, currency1, fee, tickSpacing, hooks: NATIVE_ETH };
        candidates.push({
          address: UniswapV4Adapter.poolId(v4Key),
          dex: this.id,
          fee: fee / 1000000,
          tickSpacing,
          v4Key
        });
      }
    }

    if (candidates.length === 0) return [];

    const stateViewAbi = [{
      inputs: [{ internalType: 'PoolId', name: 'poolId', type: 'bytes32' }],
      name: 'getSlot0',
      outputs: [
        { internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
        { internalType: 'int24', name: 'tick', type: 'int24' },
        { internalType: 'uint24', name: 'protocolFee', type: 'uint24' },
        { internalType: 'uint24', name: 'lpFee', type: 'uint24' }
      ],
      stateMutability: 'view',
      type: 'function'
    }] as const;

    let results: any[];
    try {
      results = await this.client.multicall({
        contracts: candidates.map(pool => ({
          address: this.stateViewAddress,
          abi: stateViewAbi,
          functionName: 'getSlot0',
          args: [pool.address as `0x${string}`]
        })),
        allowFailure: true,
        blockNumber: this.pinBlock
      });
    } catch (error: any) {
      if (isRpcFailure(error)) {
        console.error('RPC FAILURE DETAILS:', error);
        throw new Error(`RPC rate limit exceeded while checking pools for ${tokenAddress}`);
      }
      console.error(`Error checking pools for ${tokenAddress}:`, error.message);
      return [];
    }

    // An uninitialised key reads back as sqrtPriceX96 == 0, which is how a
    // pool that was never created is told apart from one that exists.
    return candidates.filter((_, i) => {
      const r: any = results[i];
      return r?.status === 'success' && typeof r.result?.[0] === 'bigint' && r.result[0] > 0n;
    });
  }

  /**
   * v4 reads go through StateView by PoolId, so the pool "address" here is that
   * id. Currencies come from the key rather than from a token0()/token1() call,
   * because the singleton has no per-pool contract to ask.
   */
  async getRawData(poolAddress: string, pool?: PoolInfo): Promise<RawPoolData> {
    const key = pool?.v4Key;

    const stateViewAbi = [
      {
        inputs: [{ internalType: 'PoolId', name: 'poolId', type: 'bytes32' }],
        name: 'getSlot0',
        outputs: [
          { internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
          { internalType: 'int24', name: 'tick', type: 'int24' },
          { internalType: 'uint24', name: 'protocolFee', type: 'uint24' },
          { internalType: 'uint24', name: 'lpFee', type: 'uint24' }
        ],
        stateMutability: 'view',
        type: 'function'
      },
      {
        inputs: [{ internalType: 'PoolId', name: 'poolId', type: 'bytes32' }],
        name: 'getLiquidity',
        outputs: [{ internalType: 'uint128', name: 'liquidity', type: 'uint128' }],
        stateMutability: 'view',
        type: 'function'
      }
    ] as const;

    try {
      const [slot0, liquidity] = await this.client.multicall({
        contracts: (['getSlot0', 'getLiquidity'] as const).map(functionName => ({
          address: this.stateViewAddress,
          abi: stateViewAbi,
          functionName,
          args: [poolAddress as `0x${string}`]
        })),
        allowFailure: false,
        blockNumber: this.pinBlock
      }) as [any, bigint];

      return {
        sqrtPriceX96: slot0[0],
        tick: slot0[1],
        liquidity,
        token0: key?.currency0,
        token1: key?.currency1,
        updatedAt: Math.floor(Date.now() / 1000)
      };
    } catch (error: any) {
      if (isRpcFailure(error)) {
        throw new Error(`RPC rate limit exceeded while fetching raw data for pool ${poolAddress}`);
      }
      throw new Error(`Failed to fetch raw data for pool ${poolAddress}: ${error.message}`);
    }
  }

  async quoteSell(request: SellQuoteRequest): Promise<(bigint | null)[]> {
    const key = request.pool.v4Key;
    if (!key) return request.amountsIn.map(() => null);

    // Declared view so viem eth_calls it; the quoter is nonpayable in source
    // but is designed to be simulated.
    const quoterAbi = [{
      inputs: [{
        components: [
          {
            components: [
              { internalType: 'Currency', name: 'currency0', type: 'address' },
              { internalType: 'Currency', name: 'currency1', type: 'address' },
              { internalType: 'uint24', name: 'fee', type: 'uint24' },
              { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
              { internalType: 'contract IHooks', name: 'hooks', type: 'address' }
            ],
            internalType: 'struct PoolKey',
            name: 'poolKey',
            type: 'tuple'
          },
          { internalType: 'bool', name: 'zeroForOne', type: 'bool' },
          { internalType: 'uint128', name: 'exactAmount', type: 'uint128' },
          { internalType: 'bytes', name: 'hookData', type: 'bytes' }
        ],
        internalType: 'struct IV4Quoter.QuoteExactSingleParams',
        name: 'params',
        type: 'tuple'
      }],
      name: 'quoteExactInputSingle',
      outputs: [
        { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
        { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' }
      ],
      stateMutability: 'view',
      type: 'function'
    }] as const;

    const zeroForOne = request.tokenIn.toLowerCase() === key.currency0.toLowerCase();

    const results = await this.client.multicall({
      contracts: request.amountsIn.map(amountIn => ({
        address: this.quoterAddress,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [{
          poolKey: {
            currency0: key.currency0 as Address,
            currency1: key.currency1 as Address,
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: key.hooks as Address
          },
          zeroForOne,
          exactAmount: amountIn,
          hookData: '0x' as `0x${string}`
        }]
      })),
      allowFailure: true,
      blockNumber: this.pinBlock
    });

    return results.map((r: any) =>
      r?.status === 'success' && typeof r.result?.[0] === 'bigint' ? r.result[0] : null
    );
  }
}
