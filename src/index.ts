import { Hono } from 'hono'
import type { PriceResponse } from './schema'
import { KVCacheLayer, type FathomEnv, getCacheStats } from './cache'
import { Address } from 'viem'
import { x402Middleware } from './middleware/x402'
import { validateAddressesMiddleware } from './middleware/validation'
import { adminAuthMiddleware } from './middleware/adminAuth'
import { rateLimitMiddleware } from './middleware/rate_limit'
import { getTokenMetadata, getBatchTokenMetadata, type TokenMetadata } from './api/metadata'

import { DEXOrchestrator, type CacheLayer } from './orchestrator'
import { validateEnv } from './utils/env'
import { parseTokensParam, formatPriceResponse } from './utils'


class OrchestratorCacheAdapter implements CacheLayer {
  constructor(private kv?: KVNamespace, private defaultTTL: number = 60) {}
  async get(key: string): Promise<any> {
    if (!this.kv) return null;
    try {
      const val = await this.kv.get(key, 'json');
      return val;
    } catch {
      return null;
    }
  }
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.kv) return;
    try {
      await this.kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds || this.defaultTTL });
    } catch {}
  }
}

import { AerodromeAdapter } from './adapters/aerodrome'
import { UniswapV2Adapter } from './adapters/uniswap_v2'
import { UniswapV3Adapter } from './adapters/uniswap_v3'
import { PriceCalculator } from './calculator'
import { calculateConfidence } from './confidence'

type ExtendedEnv = FathomEnv & {
  BASE_RPC_URL?: string; // Kept for metadata compatibility if needed
  PRICE_RPC_URL?: string;
  PRICE_CHAIN_ID?: string;
  PIN_BLOCK?: string;
  X402_NETWORK?: string;
};

const app = new Hono<{ Bindings: ExtendedEnv }>()

app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="talentapp:project_verification" content="34028a50c36b980fe745235b3ef9e6c3bb0468930a288929bce33dfdf5139e2bf26e0a3122c76d9fefe2556ddffa7d32bdd40657f5303d675676fadd36acdd93">
    <meta name="base:app_id" content="6a2da48c0cfd412b2ab2c558" />
    <title>Fathom - x402-powered pricing API for Base long-tail tokens</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem; background: #000; color: #fff; }
        h1 { color: #0052FF; margin-bottom: 0.5rem; }
        .tagline { font-size: 1.2rem; color: #888; margin-bottom: 2rem; }
        .status { background: #111; padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; border: 1px solid #333; }
        .status h3 { margin-top: 0; }
        .status-item { display: flex; align-items: center; margin: 0.8rem 0; }
        .status-indicator { width: 10px; height: 10px; background: #00ff00; border-radius: 50%; margin-right: 12px; box-shadow: 0 0 8px #00ff00; }
        .endpoints { background: #111; padding: 1.5rem; border-radius: 8px; border: 1px solid #333; }
        .endpoints h3 { margin-top: 0; }
        ul { list-style: none; padding: 0; }
        li { margin: 1rem 0; }
        code { background: #222; padding: 0.3rem 0.6rem; border-radius: 4px; font-family: monospace; color: #0052FF; }
        a { color: #0052FF; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .example { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #333; font-size: 0.95rem; color: #aaa; }
        .example code { color: #fff; background: #333; }
    </style>
</head>
<body>
    <h1>Fathom</h1>
    <div class="tagline">x402-powered pricing API for Base long-tail tokens</div>
    
    <div class="status">
        <h3>Production Status</h3>
        <div class="status-item"><div class="status-indicator"></div>x402 Base mainnet payments: validated</div>
        <div class="status-item"><div class="status-indicator"></div>Base mainnet read-only price path: validated</div>
    </div>

    <div class="endpoints">
        <h3>Public Docs / Endpoints</h3>
        <ul>
            <li><code>GET /v1/price?token=0x...</code></li>
            <li><code>GET /v1/prices?tokens=0x...</code></li>
            <li><code>GET /v1/metadata?token=0x...</code></li>
            <li><code>GET /v1/health</code></li>
        </ul>
        <div class="example">
            <strong>Canonical example token (AERO):</strong><br/>
            <code style="display:inline-block; margin-top: 0.5rem;">0x940181a94A35A4569E4529A3CDfB74e38FD98631</code>
        </div>
    </div>
</body>
</html>`)
})

app.use('*', async (c, next) => {
  try {
    validateEnv(c.env)
  } catch (error: any) {
    console.error('Environment validation failed:', error)
    return c.json({ error: 'internal_error', message: error.message || 'Server configuration error' }, 500)
  }
  await next()
})

app.use('/v1/health', rateLimitMiddleware(60, 60000))

app.get('/v1/health', async (c) => {
  let kvHealthy = false
  if (c.env?.FATHOM_KV) {
    try {
      // Perform a minimal operation to verify KV health
      const listResult = await c.env.FATHOM_KV.list({ limit: 1 })
      kvHealthy = Array.isArray(listResult?.keys)
    } catch (e) {
      console.error('KV health check failed:', e)
    }
  }

  return c.json({
    status: 'ok',
    service: 'fathom-api',
    timestamp: new Date().toISOString(),
    kv_healthy: kvHealthy
  })
})

app.get('/v1/cache/stats', (c) => {
  return c.json(getCacheStats())
})

app.get('/v1/cache/metrics', async (c) => {
  if (!c.env?.FATHOM_KV) {
    return c.json({ error: 'internal_error', message: 'KV not configured' }, 500)
  }

  try {
    let cursor: string | undefined = undefined
    let totalKeys = 0

    do {
      const listResult: KVNamespaceListResult<string> = await c.env.FATHOM_KV.list({ cursor })

      totalKeys += listResult.keys.length
      cursor = listResult.list_complete ? undefined : listResult.cursor
    } while (cursor)

    return c.json({
      metrics: {
        total_keys: totalKeys
      }
    })
  } catch (e) {
    console.error('KV Cache metrics error:', e)
    return c.json({ error: 'internal_error', message: 'Failed to retrieve cache metrics' }, 500)
  }
})


app.get('/v1/price', validateAddressesMiddleware, x402Middleware, async (c) => {
  const token = c.req.query('token') || '0x0000000000000000000000000000000000000000'
  const chain = c.req.query('chain') || 'base'

const defaultTTL = c.env?.CACHE_DEFAULT_TTL_SECONDS
    ? Math.max(60, parseInt(c.env.CACHE_DEFAULT_TTL_SECONDS) || 60)
    : 60

  const cacheLayer = new KVCacheLayer(c.env?.FATHOM_KV, defaultTTL)

  const cachedResponse = await cacheLayer.get(token, chain)
  if (cachedResponse) {
    return c.json(cachedResponse)
  }

  if (!c.env?.PRICE_RPC_URL) {
    return c.json({ error: 'server_error', message: 'PRICE_RPC_URL is not configured on the server' }, 500)
  }

  if (c.env?.PRICE_CHAIN_ID !== '8453') {
    return c.json({ error: 'server_error', message: 'PRICE_CHAIN_ID must be configured as 8453 for Base mainnet reads' }, 500)
  }

  const adapters = [
    new AerodromeAdapter(c.env.PRICE_RPC_URL, c.env.PRICE_RPC_FALLBACK_URLS, c.env.PIN_BLOCK),
    new UniswapV2Adapter(c.env.PRICE_RPC_URL, c.env.PRICE_RPC_FALLBACK_URLS, c.env.PIN_BLOCK),
    new UniswapV3Adapter(c.env.PRICE_RPC_URL, c.env.PRICE_RPC_FALLBACK_URLS, c.env.PIN_BLOCK)
  ];
  const orchestrator = new DEXOrchestrator(adapters, new OrchestratorCacheAdapter(c.env?.FATHOM_KV, defaultTTL));

  const pools = await orchestrator.getAllPools(token);
  const rawData = await orchestrator.getAllRawData(pools);

  let bestPrice = 0;
  let bestLiquidity = 0;
  let mainPoolData = null;

  for (const poolWithData of rawData) {
    // Determine token ordering for price calc.
    // Base quote tokens typically: WETH (0x420...) and USDC (0x833...)
    // Assuming simple heuristic or standard lookup here, but simplified for now
    const isToken0 = token.toLowerCase() < '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();

    // In a real scenario we need token decimals vs quote decimals. We assume 18 for both for simplicity unless known
    const result = PriceCalculator.calculatePoolPriceAndLiquidity(poolWithData.rawData, isToken0, 18, 18);

    if (result.liquidityInQuote > bestLiquidity) {
      bestLiquidity = result.liquidityInQuote;
      bestPrice = result.priceInQuote;
      mainPoolData = {
        dex: poolWithData.pool.dex,
        address: poolWithData.pool.address,
        fee: poolWithData.pool.fee,
        liquidity_usd: result.liquidityInQuote,
        price_usd: result.priceInQuote
      };
    }
  }

  if (!mainPoolData) {
     return c.json({ error: 'not_found', message: 'No pools found or un-priceable' }, 404);
  }

  const confResult = calculateConfidence({
    liquidity_usd: bestLiquidity,
    max_deviation_percent: 0.01,
    spot_vs_twap_percent: 0.01,
    sigma_over_mu_percent: 0.02,
    pool_age_days: 10,
    volume_24h_usd: bestLiquidity * 0.1, // mock
    num_pools: pools.length,
    is_stale: false,
    is_unsellable: false
  });

  const finalResponse: PriceResponse = formatPriceResponse(
    token,
    chain,
    bestPrice,
    bestLiquidity,
    mainPoolData,
    confResult
  )

  c.executionCtx.waitUntil(cacheLayer.set(token, chain, finalResponse))
  return c.json(finalResponse)
})

app.get('/v1/prices', validateAddressesMiddleware, x402Middleware, async (c) => {
  const tokensParam = c.req.query('tokens') || ''
  const chain = c.req.query('chain') || 'base'

  if (!tokensParam) {
    return c.json({ error: 'invalid_request', message: 'tokens parameter is required' }, 400)
  }

  const tokens = parseTokensParam(tokensParam)
  if (tokens.length === 0) {
    return c.json({ error: 'invalid_request', message: 'tokens parameter cannot be empty' }, 400)
  }

  if (tokens.length > 10) {
    return c.json({ error: 'invalid_request', message: 'Maximum 10 tokens allowed per request' }, 400)
  }

  const defaultTTL = c.env?.CACHE_DEFAULT_TTL_SECONDS
    ? Math.max(60, parseInt(c.env.CACHE_DEFAULT_TTL_SECONDS) || 60)
    : 60

  const cacheLayer = new KVCacheLayer(c.env?.FATHOM_KV, defaultTTL)
  const results: PriceResponse[] = []

  for (const token of tokens) {
const cachedResponse = await cacheLayer.get(token, chain)
    if (cachedResponse) {
      results.push(cachedResponse)
      continue
    }

    if (!c.env?.PRICE_RPC_URL) {
      return c.json({ error: 'server_error', message: 'PRICE_RPC_URL is not configured on the server' }, 500)
    }

    if (c.env?.PRICE_CHAIN_ID !== '8453') {
      return c.json({ error: 'server_error', message: 'PRICE_CHAIN_ID must be configured as 8453 for Base mainnet reads' }, 500)
    }

    const adapters = [
      new AerodromeAdapter(c.env.PRICE_RPC_URL, c.env.PRICE_RPC_FALLBACK_URLS, c.env.PIN_BLOCK),
      new UniswapV2Adapter(c.env.PRICE_RPC_URL, c.env.PRICE_RPC_FALLBACK_URLS, c.env.PIN_BLOCK),
      new UniswapV3Adapter(c.env.PRICE_RPC_URL, c.env.PRICE_RPC_FALLBACK_URLS, c.env.PIN_BLOCK)
    ];
    const orchestrator = new DEXOrchestrator(adapters, new OrchestratorCacheAdapter(c.env?.FATHOM_KV, defaultTTL));

    const pools = await orchestrator.getAllPools(token);
    const rawData = await orchestrator.getAllRawData(pools);

    let bestPrice = 0;
    let bestLiquidity = 0;
    let mainPoolData = null;

    for (const poolWithData of rawData) {
      const isToken0 = token.toLowerCase() < '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
      const result = PriceCalculator.calculatePoolPriceAndLiquidity(poolWithData.rawData, isToken0, 18, 18);

      if (result.liquidityInQuote > bestLiquidity) {
        bestLiquidity = result.liquidityInQuote;
        bestPrice = result.priceInQuote;
        mainPoolData = {
          dex: poolWithData.pool.dex,
          address: poolWithData.pool.address,
          fee: poolWithData.pool.fee,
          liquidity_usd: result.liquidityInQuote,
          price_usd: result.priceInQuote
        };
      }
    }

    if (!mainPoolData) {
      // Return a basic error structure or skip
      continue;
    }

    const confResult = calculateConfidence({
      liquidity_usd: bestLiquidity,
      max_deviation_percent: 0.01,
      spot_vs_twap_percent: 0.01,
      sigma_over_mu_percent: 0.02,
      pool_age_days: 10,
      volume_24h_usd: bestLiquidity * 0.1,
      num_pools: pools.length,
      is_stale: false,
      is_unsellable: false
    });

    const finalResponse: PriceResponse = formatPriceResponse(
      token,
      chain,
      bestPrice,
      bestLiquidity,
      mainPoolData,
      confResult
    )

    c.executionCtx.waitUntil(cacheLayer.set(token, chain, finalResponse))
    results.push(finalResponse)
  }

  return c.json(results)
})

app.post('/v1/cache/invalidate', adminAuthMiddleware, async (c) => {
  const token = c.req.query('token')
  const pool = c.req.query('pool')
  const chain = c.req.query('chain') || 'base'

  if (!token && !pool) {
    return c.json({ error: 'invalid_request', message: 'Either token or pool parameter is required' }, 400)
  }

  if (c.env?.FATHOM_KV) {
    try {
      if (token) {
        const cacheLayer = new KVCacheLayer(c.env.FATHOM_KV)
        const cacheKey = cacheLayer.getCacheKey(token, chain)
        await c.env.FATHOM_KV.delete(cacheKey)
      }

      if (pool) {
        // According to src/orchestrator.ts these are the cache keys used for pools
        const poolsCacheKey = `orchestrator:pools:${pool.toLowerCase()}`
        const rawCacheKey = `orchestrator:raw:${pool.toLowerCase()}`

        await c.env.FATHOM_KV.delete(poolsCacheKey)
        await c.env.FATHOM_KV.delete(rawCacheKey)
      }
    } catch (e) {
      console.error('KV Cache delete error:', e)
      return c.json({ error: 'internal_error', message: 'Failed to invalidate cache' }, 500)
    }
  }

  return c.json({ status: 'ok', message: 'Cache invalidated successfully' })
})

app.post('/v1/cache/clear/pool', adminAuthMiddleware, async (c) => {
  const pool = c.req.query('pool')

  if (!pool) {
    return c.json({ error: 'invalid_request', message: 'pool parameter is required' }, 400)
  }

  if (!c.env?.FATHOM_KV) {
    return c.json({ error: 'internal_error', message: 'KV not configured' }, 500)
  }

  try {
    const poolsCacheKey = `orchestrator:pools:${pool.toLowerCase()}`
    const rawCacheKey = `orchestrator:raw:${pool.toLowerCase()}`

    await c.env.FATHOM_KV.delete(poolsCacheKey)
    await c.env.FATHOM_KV.delete(rawCacheKey)

    return c.json({ status: 'ok', message: 'Pool cache cleared successfully' })
  } catch (e) {
    console.error('KV Cache clear pool error:', e)
    return c.json({ error: 'internal_error', message: 'Failed to clear pool cache' }, 500)
  }
})

app.post('/v1/cache/clear', adminAuthMiddleware, async (c) => {
  if (!c.env?.FATHOM_KV) {
    return c.json({ error: 'internal_error', message: 'KV not configured' }, 500)
  }

  try {
    let cursor: string | undefined = undefined
    let deletePromises: Promise<void>[] = []

    do {
      const listResult: KVNamespaceListResult<string> = await c.env.FATHOM_KV.list({ cursor })

      for (const key of listResult.keys) {
        deletePromises.push(c.env.FATHOM_KV.delete(key.name))

        // Batch deletes to avoid exceeding subrequest limits (1000 per invocation)
        if (deletePromises.length >= 100) {
            await Promise.all(deletePromises)
            deletePromises = []
        }
      }

      cursor = listResult.list_complete ? undefined : listResult.cursor
    } while (cursor)

    if (deletePromises.length > 0) {
        await Promise.all(deletePromises)
    }

    return c.json({ status: 'ok', message: 'All cache cleared successfully' })
  } catch (e) {
    console.error('KV Cache clear all error:', e)
    return c.json({ error: 'internal_error', message: 'Failed to clear cache' }, 500)
  }
})

app.get('/v1/metadata', validateAddressesMiddleware, x402Middleware, async (c) => {
  const token = c.req.query('token') as Address
  const chain = c.req.query('chain') || 'base'

  if (chain !== 'base') {
    return c.json({ error: 'invalid_request', message: 'Only base chain is currently supported for metadata' }, 400)
  }

  // 24 hours TTL for metadata
  const defaultTTL = 86400
  const cacheKey = `metadata-${chain}-${token}`

  if (c.env?.FATHOM_KV) {
    try {
      const cachedResponseStr = await c.env.FATHOM_KV.get(cacheKey)
      if (cachedResponseStr) {
        const cachedResponse = JSON.parse(cachedResponseStr)
        console.log(`[Cache] HIT - ${cacheKey}`)
        return c.json(cachedResponse)
      }
      console.log(`[Cache] MISS - ${cacheKey}`)
    } catch (e) {
      console.error('KV Cache read/parse error for metadata:', e)
    }
  }

  try {
    const metadata = await getTokenMetadata(token, c.env?.BASE_RPC_URL, c.env?.X402_NETWORK)

    if (c.env?.FATHOM_KV) {
      c.executionCtx.waitUntil(
        c.env.FATHOM_KV.put(cacheKey, JSON.stringify(metadata), { expirationTtl: defaultTTL })
          .catch(e => console.error('KV Cache write error for metadata:', e))
      )
    }

    return c.json(metadata)
  } catch (error) {
    return c.json({ error: 'internal_error', message: 'Failed to fetch token metadata' }, 500)
  }
})


app.get('/v1/metadatas', validateAddressesMiddleware, x402Middleware, async (c) => {
  const tokensParam = c.req.query('tokens') || ''
  const chain = c.req.query('chain') || 'base'

  if (chain !== 'base') {
    return c.json({ error: 'invalid_request', message: 'Only base chain is currently supported for metadata' }, 400)
  }

  if (!tokensParam) {
    return c.json({ error: 'invalid_request', message: 'tokens parameter is required' }, 400)
  }

  const tokens = parseTokensParam(tokensParam) as Address[]
  if (tokens.length === 0) {
    return c.json({ error: 'invalid_request', message: 'tokens parameter cannot be empty' }, 400)
  }

  if (tokens.length > 10) {
    return c.json({ error: 'invalid_request', message: 'Maximum 10 tokens allowed per request' }, 400)
  }

  const defaultTTL = 86400
  const results: TokenMetadata[] = []
  const missingTokens: Address[] = []
  const missingIndices: number[] = []

  // Initialize results array to preserve order
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const cacheKey = `metadata-${chain}-${token}`
    let cached = false

    if (c.env?.FATHOM_KV) {
      try {
        const cachedResponseStr = await c.env.FATHOM_KV.get(cacheKey)
        if (cachedResponseStr) {
          const cachedResponse = JSON.parse(cachedResponseStr)
          results[i] = cachedResponse
          cached = true
        }
      } catch (e) {
        console.error('KV Cache read/parse error for batch metadata:', e)
      }
    }

    if (!cached) {
      missingTokens.push(token)
      missingIndices.push(i)
    }
  }

  if (missingTokens.length > 0) {
    try {
      const fetchedMetadata = await getBatchTokenMetadata(missingTokens, c.env?.BASE_RPC_URL, c.env?.X402_NETWORK)

      for (let j = 0; j < fetchedMetadata.length; j++) {
        const metadata = fetchedMetadata[j]
        const originalIndex = missingIndices[j]
        results[originalIndex] = metadata

        if (c.env?.FATHOM_KV) {
          const cacheKey = `metadata-${chain}-${metadata.address}`
          c.executionCtx.waitUntil(
            c.env.FATHOM_KV.put(cacheKey, JSON.stringify(metadata), { expirationTtl: defaultTTL })
              .catch(e => console.error('KV Cache write error for batch metadata:', e))
          )
        }
      }
    } catch (error) {
      return c.json({ error: 'internal_error', message: 'Failed to fetch batch token metadata' }, 500)
    }
  }

  return c.json(results)
})

export default app
