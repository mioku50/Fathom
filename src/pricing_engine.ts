import { Address } from 'viem';
import { DEXOrchestrator } from './orchestrator';
import { PriceCalculator } from './calculator';
import { calculateConfidence } from './confidence';
import { formatPriceResponse, NO_TWAP, type TwapReport } from './utils';
import { PriceResponse } from './schema';
import { PriceRpcClient } from './utils/price_rpc';
import { PricingError } from './errors';
import { computeDispersion, type PriceSample } from './dispersion';
import {
  headlineExecution,
  constantProductDepthProfile,
  quotedDepthProfile,
  unknownDepth,
  isDepthUnknown,
  SELL_QUOTE_SIZES_USD,
  type DepthResult
} from './depth';
import type { PoolInfo } from './dex_adapter';

const WETH = '0x4200000000000000000000000000000000000006'.toLowerCase();
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
const AERO = '0x940181a94A35A4569E4529A3CDfB74e38FD98631'.toLowerCase();

/** Averaging window requested from pool oracles, in seconds. */
const TWAP_WINDOW_SECONDS = 300;

/** How many candidate pools may be tried before giving up on depth. */
const MAX_DEPTH_CANDIDATES = 3;

type MainPoolContext = {
  pool: PoolInfo;
  quoteToken: string;
  quoteDecimals: number;
  quoteUsdPrice: number;
  /** True when the pool reports real balances; false for concentrated liquidity. */
  hasRealReserves: boolean;
  /** Present only when the pool is x*y=k and depth is solvable in closed form. */
  constantProduct: {
    reserveToken: number;
    reserveQuote: number;
    quoteUsdPrice: number;
    fee: number;
  } | null;
};

export class PricingEngine {
  /**
   * USD anchors for the quote assets we price against, resolved lazily and
   * memoized per engine instance. The engine is built once per request, so a
   * 50-token batch shares one lookup per quote asset instead of repeating it
   * per token; the promise is memoized rather than the value, so tokens priced
   * concurrently share one in-flight resolution rather than racing.
   *
   * Lazy matters: a token quoted only in USDC now pays for no anchor at all,
   * where before every token paid for WETH whether it needed it or not.
   */
  private anchors = new Map<string, Promise<number | null>>();

  /** Quote assets we can convert to USD, and the decimals they use. */
  private static readonly QUOTE_ASSETS: Record<string, number> = {
    [WETH]: 18,
    [AERO]: 18
  };

  constructor(
    private orchestrator: DEXOrchestrator,
    private rpcClient: PriceRpcClient,
    private chain: string
  ) {}

  /**
   * USD price of a quote asset. USDC is the numeraire; anything else is priced
   * against it. Returns null for an asset we cannot anchor, which the caller
   * must treat as "cannot price this pool" rather than substituting a value.
   */
  private getQuoteUsdPrice(quoteToken: string): Promise<number | null> {
    const key = quoteToken.toLowerCase();
    if (key === USDC) return Promise.resolve(1);

    const decimals = PricingEngine.QUOTE_ASSETS[key];
    if (decimals === undefined) return Promise.resolve(null);

    let anchor = this.anchors.get(key);
    if (!anchor) {
      anchor = this.getBestPoolPrice(key, USDC, decimals, 6).then(result =>
        result && result.priceInQuote > 0 && Number.isFinite(result.priceInQuote)
          ? result.priceInQuote
          : null
      );
      this.anchors.set(key, anchor);
    }
    return anchor;
  }

  async calculatePrice(token: string): Promise<PriceResponse | null> {
    const lowerToken = token.toLowerCase();

    // 1. Handle USDC special case
    if (lowerToken === USDC) {
      return this.buildHardcodedResponse(token, 1.0, 100000000, 6);
    }

    // 2. Find the token's pools. Quote assets are anchored to USD lazily, as
    // each pool needs one - a wrong anchor would rescale every price quoted in
    // that asset, so a missing one skips the pool rather than guessing.
    const pools = await this.orchestrator.getAllPools(token);
    if (pools.length === 0) {
      return null;
    }

    const rawData = await this.orchestrator.getAllRawData(pools);

    let bestPriceUsd = 0;
    let bestLiquidityUsd = 0;
    let mainPoolData = null;
    // Pools we could have priced if the WETH/USD anchor had been available.
    let poolsBlockedOnAnchor = 0;
    // Every successfully priced pool is an independent observation of the same
    // token. Kept so source agreement can be measured instead of assumed.
    const samples: PriceSample[] = [];
    // Everything the depth math needs from whichever pool wins, captured as we
    // go so we do not have to re-derive or re-fetch it afterwards.
    type PoolCandidate = {
      priceUsd: number;
      liquidityUsd: number;
      poolData: any;
      context: MainPoolContext;
    };
    const candidates: PoolCandidate[] = [];

    let mainPoolContext: MainPoolContext | null = null;

    const tokenDecimals = await this.rpcClient.getTokenDecimals(token);

    for (const poolWithData of rawData) {
      if (!poolWithData.rawData.token0 || !poolWithData.rawData.token1) continue;
      
      const isToken0 = poolWithData.rawData.token0.toLowerCase() === lowerToken;
      const quoteToken = isToken0 ? poolWithData.rawData.token1 : poolWithData.rawData.token0;
      const lowerQuote = quoteToken.toLowerCase();
      
      const quoteDecimals = await this.rpcClient.getTokenDecimals(quoteToken);

      const result = PriceCalculator.calculatePoolPriceAndLiquidity(
        poolWithData.rawData,
        isToken0,
        tokenDecimals,
        quoteDecimals
      );

      // Pricing a quote asset against itself says nothing.
      if (lowerQuote === lowerToken) continue;

      const quoteUsdPrice = await this.getQuoteUsdPrice(lowerQuote);
      if (quoteUsdPrice === null) {
        // Either an asset we cannot anchor at all, or one whose anchor failed.
        // Both mean this pool cannot be converted to USD - never guess.
        if (PricingEngine.QUOTE_ASSETS[lowerQuote] !== undefined) poolsBlockedOnAnchor++;
        continue;
      }

      const priceUsd = result.priceInQuote * quoteUsdPrice;
      const liquidityUsd = result.liquidityInQuote * quoteUsdPrice;

      if (priceUsd > 0 && Number.isFinite(priceUsd) && liquidityUsd > 0) {
        samples.push({ priceUsd, liquidityUsd });
      }

      {
        const raw = poolWithData.rawData;
        const reserveTokenRaw = isToken0 ? raw.reserve0 : raw.reserve1;
        const reserveQuoteRaw = isToken0 ? raw.reserve1 : raw.reserve0;
        // Constant product only: Uniswap V2 and Aerodrome volatile pools.
        // Concentrated liquidity (no reserves) and Aerodrome stable pools
        // (x3y+y3x) need a real quoter and are left unmeasured instead.
        const constantProduct =
          reserveTokenRaw !== undefined &&
          reserveQuoteRaw !== undefined &&
          poolWithData.pool.stable !== true;

        const context: MainPoolContext = {
          pool: poolWithData.pool,
          quoteToken,
          quoteDecimals,
          quoteUsdPrice,
          hasRealReserves: reserveTokenRaw !== undefined && reserveQuoteRaw !== undefined,
          constantProduct: constantProduct
            ? {
                reserveToken: Number(reserveTokenRaw) / Math.pow(10, tokenDecimals),
                reserveQuote: Number(reserveQuoteRaw) / Math.pow(10, quoteDecimals),
                quoteUsdPrice,
                fee: poolWithData.pool.fee ?? 0.003
              }
            : null
        };

        const poolHasRealReserves = context.hasRealReserves;
        const poolData = {
          dex: poolWithData.pool.dex,
          address: poolWithData.pool.address,
          fee: poolWithData.pool.fee,
          // Same rule as the top-level field: a concentrated-liquidity pool has
          // no balance to report, so it reports none rather than L * sqrtP.
          liquidity_usd: poolHasRealReserves ? liquidityUsd : undefined,
          price_usd: priceUsd
        };

        if (priceUsd > 0 && Number.isFinite(priceUsd) && liquidityUsd > 0) {
          candidates.push({ priceUsd, liquidityUsd, poolData, context });
        }
      }
    }

    // Rank by the liquidity figure we have, but do not trust it blindly: for
    // concentrated liquidity it is derived from L * sqrtP, which is why the
    // depth pass below is allowed to move on to the next candidate.
    candidates.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    if (candidates.length > 0) {
      bestPriceUsd = candidates[0].priceUsd;
      bestLiquidityUsd = candidates[0].liquidityUsd;
      mainPoolData = candidates[0].poolData;
      mainPoolContext = candidates[0].context;
    }

    // Guards
    if (!mainPoolData || bestPriceUsd <= 0 || !Number.isFinite(bestPriceUsd)) {
      // Distinguish "this token has no usable liquidity" from "we could not
      // price its liquidity because our USD anchor was unavailable".
      if (poolsBlockedOnAnchor > 0) {
        throw new PricingError(
          'stale_anchor',
          'WETH/USD anchor unavailable; WETH-quoted pools could not be converted to USD'
        );
      }
      return null;
    }
    if (lowerToken === WETH && (bestPriceUsd < 100 || bestPriceUsd > 20000)) {
      return null;
    }

    // Measured from the pool prices we already computed - no extra RPC calls.
    const dispersion = computeDispersion(samples);

    // What an agent actually gets on the way out, rather than what is parked.
    //
    // The ranking above leans on a liquidity figure that, for concentrated
    // liquidity, is derived from L * sqrtP - the very number we refuse to
    // report. So the deepest-looking pool can turn out to be one that cannot
    // fill the trade at all, while a sibling pool at another tick spacing can.
    // Rather than trusting that ranking, walk the candidates until one answers.
    let depth: DepthResult = unknownDepth();
    for (const candidate of candidates.slice(0, MAX_DEPTH_CANDIDATES)) {
      const ctx = candidate.context;
      const attempt = ctx.constantProduct
        ? constantProductDepthProfile(ctx.constantProduct)
        : await this.quoteDepth(token, tokenDecimals, candidate.priceUsd, ctx);

      if (!isDepthUnknown(attempt)) {
        depth = attempt;
        // The venue that can actually execute is the one worth reporting.
        bestPriceUsd = candidate.priceUsd;
        bestLiquidityUsd = candidate.liquidityUsd;
        mainPoolData = candidate.poolData;
        mainPoolContext = ctx;
        break;
      }
    }

    // The pool's own oracle, so spot can finally be compared against something.
    const twap = mainPoolContext
      ? await this.readTwap(token, tokenDecimals, bestPriceUsd, mainPoolContext)
      : NO_TWAP;

    const execution = headlineExecution(depth);

    const confResult = calculateConfidence({
      // Uniswap V3's figure is derived from `L * sqrtP`, an active-range
      // parameter rather than a balance. Reporting it as liquidity would be
      // the same class of fabrication this engine has been removing, so the
      // component is excluded instead and its weight redistributed.
      liquidity_usd: mainPoolContext?.hasRealReserves ? bestLiquidityUsd : null,
      execution_impact_bps: execution.impactBps,
      execution_fillable: execution.fillable,
      max_deviation_percent: dispersion.maxDeviation,
      sigma_over_mu_percent: dispersion.sigmaOverMu,
      spot_vs_twap_percent:
        twap.spot_deviation_bps === null ? null : twap.spot_deviation_bps / 10000,
      // Not yet measured. Passing null keeps these components out of the score
      // rather than crediting the token for checks that never ran.
      pool_age_days: null,
      volume_24h_usd: null,
      // Sources that actually priced the token, not pools merely discovered:
      // empty fee tiers used to suppress the single_pool ceiling.
      num_pools: dispersion.sourceCount,
      is_stale: null,
      is_unsellable: null
    });

    if (isDepthUnknown(depth)) {
      // Says plainly that exit liquidity was not established for this token,
      // rather than leaving a reader to infer it from null fields.
      confResult.flags.push('depth_unavailable');
    }

    const reportedLiquidityUsd = mainPoolContext?.hasRealReserves ? bestLiquidityUsd : null;

    return formatPriceResponse(
      token,
      this.chain,
      bestPriceUsd,
      reportedLiquidityUsd,
      mainPoolData,
      confResult,
      {
        source_count: dispersion.sourceCount,
        price_dispersion_bps:
          dispersion.maxDeviation === null ? null : dispersion.maxDeviation * 10000,
        depth,
        twap
      }
    );
  }

  /**
   * Read the main pool's own time-weighted average price and compare spot to it.
   * A large gap is the classic manipulation signature, which is why this feeds
   * both the response and the confidence model.
   */
  private async readTwap(
    token: string,
    tokenDecimals: number,
    spotPriceUsd: number,
    ctx: {
      pool: PoolInfo;
      quoteToken: string;
      quoteDecimals: number;
      quoteUsdPrice: number;
    }
  ): Promise<TwapReport> {
    if (!(spotPriceUsd > 0) || !Number.isFinite(spotPriceUsd) || !(ctx.quoteUsdPrice > 0)) {
      return NO_TWAP;
    }

    // Price one whole token, so the averaged output converts straight to USD.
    const amountIn = BigInt(Math.round(Math.pow(10, tokenDecimals)));

    const result = await this.orchestrator.getTwapAmountOut({
      pool: ctx.pool,
      tokenIn: token,
      tokenOut: ctx.quoteToken,
      amountIn,
      windowSeconds: TWAP_WINDOW_SECONDS
    });
    if (!result) return NO_TWAP;

    const twapPriceUsd =
      (Number(result.amountOut) / Math.pow(10, ctx.quoteDecimals)) * ctx.quoteUsdPrice;
    if (!Number.isFinite(twapPriceUsd) || twapPriceUsd <= 0) return NO_TWAP;

    return {
      price_usd: twapPriceUsd,
      window_seconds: result.windowSeconds,
      spot_deviation_bps: (Math.abs(spotPriceUsd - twapPriceUsd) / twapPriceUsd) * 10000
    };
  }

  /**
   * Ask the DEX to simulate the sells we advertise. Used for curves we cannot
   * solve in closed form - concentrated liquidity and Aerodrome's stable pools.
   */
  private async quoteDepth(
    token: string,
    tokenDecimals: number,
    spotPriceUsd: number,
    ctx: {
      pool: PoolInfo;
      quoteToken: string;
      quoteDecimals: number;
      quoteUsdPrice: number;
    }
  ): Promise<DepthResult> {
    if (!(spotPriceUsd > 0) || !Number.isFinite(spotPriceUsd) || !(ctx.quoteUsdPrice > 0)) {
      return unknownDepth();
    }

    const amountsIn: bigint[] = [];
    for (const size of SELL_QUOTE_SIZES_USD) {
      const raw = (size / spotPriceUsd) * Math.pow(10, tokenDecimals);
      if (!Number.isFinite(raw) || raw <= 0) return unknownDepth();
      amountsIn.push(BigInt(Math.floor(raw)));
    }

    const amountsOut = await this.orchestrator.quoteSell({
      pool: ctx.pool,
      tokenIn: token,
      tokenOut: ctx.quoteToken,
      amountsIn
    });
    if (!amountsOut) return unknownDepth();

    const proceedsUsd = amountsOut.map(a =>
      a === null ? null : (Number(a) / Math.pow(10, ctx.quoteDecimals)) * ctx.quoteUsdPrice
    );

    return quotedDepthProfile(proceedsUsd, spotPriceUsd);
  }

  private async getBestPoolPrice(token: string, quote: string, tokenDec: number, quoteDec: number) {
    const pools = await this.orchestrator.getAllPools(token);
    const rawData = await this.orchestrator.getAllRawData(pools);
    let bestLiquidity = 0;
    let bestPrice = 0;

    for (const p of rawData) {
      if (!p.rawData.token0 || !p.rawData.token1) continue;
      const isToken0 = p.rawData.token0.toLowerCase() === token.toLowerCase();
      const pQuote = isToken0 ? p.rawData.token1 : p.rawData.token0;
      if (pQuote.toLowerCase() !== quote.toLowerCase()) continue;

      const res = PriceCalculator.calculatePoolPriceAndLiquidity(p.rawData, isToken0, tokenDec, quoteDec);
      if (res.liquidityInQuote > bestLiquidity) {
        bestLiquidity = res.liquidityInQuote;
        bestPrice = res.priceInQuote;
      }
    }
    return bestLiquidity > 0 ? { priceInQuote: bestPrice, liquidityInQuote: bestLiquidity } : null;
  }

  private buildHardcodedResponse(token: string, priceUsd: number, liquidityUsd: number, decimals: number): PriceResponse {
    return formatPriceResponse(
      token,
      this.chain,
      priceUsd,
      liquidityUsd,
      {
        dex: 'hardcoded',
        address: '0x0',
        liquidity_usd: liquidityUsd,
        price_usd: priceUsd
      },
      {
        // Same 0-100 scale as calculateConfidence(). USDC is the numeraire this
        // engine prices everything else against, so its value is defined rather
        // than measured - the flag says so explicitly, and no component of the
        // confidence model was evaluated to produce it.
        confidence: 100,
        label: 'reliable',
        flags: ['hardcoded_numeraire']
      },
      { source_count: 0, price_dispersion_bps: null, depth: unknownDepth(), twap: NO_TWAP }
    );
  }
}
