import { Address } from 'viem';
import { DEXOrchestrator } from './orchestrator';
import { PriceCalculator } from './calculator';
import { calculateConfidence } from './confidence';
import { formatPriceResponse } from './utils';
import { PriceResponse } from './schema';
import { PriceRpcClient } from './utils/price_rpc';
import { PricingError } from './errors';

const WETH = '0x4200000000000000000000000000000000000006'.toLowerCase();
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
const AERO = '0x940181a94A35A4569E4529A3CDfB74e38FD98631'.toLowerCase();

export class PricingEngine {
  constructor(
    private orchestrator: DEXOrchestrator,
    private rpcClient: PriceRpcClient,
    private chain: string
  ) {}

  async calculatePrice(token: string): Promise<PriceResponse | null> {
    const lowerToken = token.toLowerCase();

    // 1. Handle USDC special case
    if (lowerToken === USDC) {
      return this.buildHardcodedResponse(token, 1.0, 100000000, 6);
    }

    // 2. We need a WETH/USD anchor if any of this token's pools are WETH-quoted.
    // If the anchor cannot be established we leave it null and skip those pools
    // rather than substituting a placeholder: a wrong anchor rescales every
    // WETH-quoted price by roughly the ETH price itself.
    let wethPriceUsd: number | null = null;
    if (lowerToken !== WETH) {
      const wethResult = await this.getBestPoolPrice(WETH, USDC, 18, 6);
      if (wethResult && wethResult.priceInQuote > 0 && Number.isFinite(wethResult.priceInQuote)) {
        wethPriceUsd = wethResult.priceInQuote;
      }
    }

    // 3. For the requested token, try pools.
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

      let priceUsd = 0;
      let liquidityUsd = 0;

      if (lowerQuote === USDC) {
        priceUsd = result.priceInQuote;
        liquidityUsd = result.liquidityInQuote;
      } else if (lowerQuote === WETH && lowerToken !== WETH) {
        if (wethPriceUsd === null) {
          poolsBlockedOnAnchor++;
          continue;
        }
        priceUsd = result.priceInQuote * wethPriceUsd;
        liquidityUsd = result.liquidityInQuote * wethPriceUsd;
      } else {
        // Skip unhandled quote tokens for now (e.g. AERO quote)
        continue;
      }

      if (liquidityUsd > bestLiquidityUsd) {
        bestLiquidityUsd = liquidityUsd;
        bestPriceUsd = priceUsd;
        mainPoolData = {
          dex: poolWithData.pool.dex,
          address: poolWithData.pool.address,
          fee: poolWithData.pool.fee,
          liquidity_usd: liquidityUsd,
          price_usd: priceUsd
        };
      }
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

    const confResult = calculateConfidence({
      liquidity_usd: bestLiquidityUsd,
      max_deviation_percent: 0.01,
      spot_vs_twap_percent: 0.01,
      sigma_over_mu_percent: 0.02,
      pool_age_days: 10,
      volume_24h_usd: bestLiquidityUsd * 0.1,
      num_pools: pools.length,
      is_stale: false,
      is_unsellable: false
    });

    return formatPriceResponse(
      token,
      this.chain,
      bestPriceUsd,
      bestLiquidityUsd,
      mainPoolData,
      confResult
    );
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
        // than measured - the flag says so explicitly.
        confidence: 100,
        label: 'reliable',
        flags: ['hardcoded_numeraire']
      }
    );
  }
}
