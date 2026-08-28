import { Hono } from 'hono'
import type { PriceResponse, BatchPriceResponse, BatchPriceResult } from './schema'
import { KVCacheLayer, type FathomEnv, getCacheStats } from './cache'
import { Address } from 'viem'
import { x402Middleware } from './middleware/x402'
import { validateAddressesMiddleware } from './middleware/validation'
import { adminAuthMiddleware } from './middleware/adminAuth'
import { rateLimitMiddleware } from './middleware/rate_limit'
import { getTokenMetadata, getBatchTokenMetadata, type TokenMetadata } from './api/metadata'
import { DEXOrchestrator, type CacheLayer } from './orchestrator'
import { AerodromeAdapter } from './adapters/aerodrome'
import { AerodromeSlipstreamAdapter } from './adapters/aerodrome_slipstream'
import { UniswapV2Adapter } from './adapters/uniswap_v2'
import { UniswapV3Adapter } from './adapters/uniswap_v3'
import { PricingEngine } from './pricing_engine'
import { PriceRpcClient } from './utils/price_rpc'
import { parseTokensParam } from './utils'
import { validateEnv } from './utils/env'
import { isPricingError } from './errors'
import { mapWithConcurrency } from './concurrency'

/**
 * Tokens priced in parallel within one batch request. Bounded so a 50-token
 * batch does not fan out every token's RPC calls at once.
 */
const BATCH_CONCURRENCY = 8

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

/**
 * Builds the pricing stack for one request. Every adapter shares a single RPC
 * client, and the returned engine memoizes its WETH/USD anchor, so a batch pays
 * for both once rather than once per token.
 */
function buildPricingEngine(env: ExtendedEnv, chain: string, defaultTTL: number): PricingEngine {
  const rpcClient = new PriceRpcClient(env.PRICE_RPC_URL!, env.PRICE_RPC_FALLBACK_URLS)
  const adapters = [
    new AerodromeAdapter(env.PRICE_RPC_URL!, env.PRICE_RPC_FALLBACK_URLS, env.PIN_BLOCK, rpcClient),
    new AerodromeSlipstreamAdapter(env.PRICE_RPC_URL!, env.PRICE_RPC_FALLBACK_URLS, env.PIN_BLOCK, rpcClient),
    new UniswapV2Adapter(env.PRICE_RPC_URL!, env.PRICE_RPC_FALLBACK_URLS, env.PIN_BLOCK, rpcClient),
    new UniswapV3Adapter(env.PRICE_RPC_URL!, env.PRICE_RPC_FALLBACK_URLS, env.PIN_BLOCK, rpcClient)
  ]
  const orchestrator = new DEXOrchestrator(adapters, new OrchestratorCacheAdapter(env.FATHOM_KV, defaultTTL))
  return new PricingEngine(orchestrator, rpcClient, chain)
}

type ExtendedEnv = FathomEnv & {
  BASE_RPC_URL?: string; // Kept for metadata compatibility if needed
  PRICE_RPC_URL?: string;
  PRICE_CHAIN_ID?: string;
  PIN_BLOCK?: string;
  X402_NETWORK?: string;
};

const app = new Hono<{ Bindings: ExtendedEnv }>()

import {
  priceInputSchema, priceOutputSchema,
  pricesInputSchema, pricesOutputSchema,
  metadataInputSchema, metadataOutputSchema,
  metadatasInputSchema, metadatasOutputSchema
} from './schemas/x402DiscoverySchemas'

app.get('/', (c) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate')
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fathom - x402-powered Base token price oracle for agents</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem; background: #000; color: #fff; }
        h1 { color: #0052FF; margin-bottom: 0.5rem; }
        .tagline { font-size: 1.2rem; color: #888; margin-bottom: 2rem; }
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
    <div class="tagline">x402-powered Base token price oracle for agents</div>
    
    <div class="endpoints">
        <h3>Primary Endpoint</h3>
        <ul>
            <li><code>GET <a href="/v1/prices?tokens=0x940181a94A35A4569E4529A3CDfB74e38FD98631,0x4200000000000000000000000000000000000006">/v1/prices</a></code></li>
        </ul>
        <p><strong>Price:</strong> $0.003 per batch</p>
        <p><strong>Limit:</strong> Up to 50 Base ERC-20 token addresses</p>
        <p><strong>Network:</strong> Base mainnet</p>
        <p><strong>Payment:</strong> USDC via x402</p>

        <h3>Public Docs / Agent Integration</h3>
        <ul>
            <li><code>GET <a href="/.well-known/x402">/.well-known/x402</a></code> - x402 Manifest</li>
            <li><code>GET <a href="/openapi.json">/openapi.json</a></code> - OpenAPI 3.1 Spec</li>
            <li><code>GET <a href="/schemas/prices.input.json">/schemas/prices.input.json</a></code> - Input Schema</li>
            <li><code>GET <a href="/schemas/prices.output.json">/schemas/prices.output.json</a></code> - Output Schema</li>
        </ul>
    </div>
</body>
</html>`)
})

app.get('/schemas/price.input.json', (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate'); return c.json(priceInputSchema) })
app.get('/schemas/price.output.json', (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate'); return c.json(priceOutputSchema) })
app.get('/schemas/prices.input.json', (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate'); return c.json(pricesInputSchema) })
app.get('/schemas/prices.output.json', (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate'); return c.json(pricesOutputSchema) })
app.get('/schemas/metadata.input.json', (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate'); return c.json(metadataInputSchema) })
app.get('/schemas/metadata.output.json', (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate'); return c.json(metadataOutputSchema) })
app.get('/schemas/metadatas.input.json', (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate'); return c.json(metadatasInputSchema) })
app.get('/schemas/metadatas.output.json', (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate'); return c.json(metadatasOutputSchema) })

app.get('/.well-known/x402', (c) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate')
  return c.json({
    name: "Fathom",
    description: "x402-powered Base token price oracle for agents",
    version: "1.0.0",
    baseUrl: "https://fathom-api.mioku-fathom.workers.dev",
    network: "eip155:8453",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base USDC
    primaryEndpoint: "/v1/prices",
    endpoints: [
      "/v1/prices",
      "/v1/metadata",
      "/v1/price"
    ],
    pricing: {
      "/v1/prices": "$0.003",
      "/v1/metadata": "$0.001",
      "/v1/price": "$0.001"
    },
    maxBatchTokens: 50,
    schemaUrls: {
      input: "/schemas/prices.input.json",
      output: "/schemas/prices.output.json"
    },
    tags: ["base", "x402", "price-oracle", "batch-pricing", "liquidity", "dex", "agents", "wallets", "trading"]
  })
})

app.get('/openapi.json', (c) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate')
  return c.json({
    openapi: "3.1.0",
    info: {
      title: "Fathom API",
      version: "1.0.0",
      description: "x402-powered Base token price oracle for agents"
    },
    paths: {
      "/v1/prices": {
        get: {
          summary: "Batch pricing for Base tokens",
          description: "Batch price, liquidity, confidence, and risk flags for Base token lists. Note: Requires x402 payment (HTTP 402 Payment Required returned when unpaid).",
          parameters: [
            {
              name: "tokens",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Comma-separated list of Base ERC-20 token addresses (1 to 50)",
              example: "0x940181a94A35A4569E4529A3CDfB74e38FD98631,0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
            },
            {
              name: "chain",
              in: "query",
              required: false,
              schema: { type: "string", default: "base" },
              description: "Target chain (default: base)"
            }
          ],
          responses: {
            "200": {
              description: "Successful pricing result",
              content: { "application/json": { schema: pricesOutputSchema } }
            },
            "402": {
              description: "Payment Required - Follow x402 protocol instructions in headers to pay 0.003 USDC via Base."
            }
          }
        }
      },
      "/v1/price": {
        get: {
          summary: "Price for a single Base token",
          description: "Returns price, liquidity, confidence score, main pool, and risk flags for a Base ERC-20 token. Requires x402 payment.",
          parameters: [
            {
              name: "token",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Base ERC-20 token address",
              example: "0x940181a94A35A4569E4529A3CDfB74e38FD98631"
            }
          ],
          responses: {
            "200": {
              description: "Successful pricing result",
              content: { "application/json": { schema: priceOutputSchema } }
            },
            "402": {
              description: "Payment Required - Follow x402 protocol instructions to pay 0.001 USDC."
            }
          }
        }
      },
      "/v1/metadata": {
        get: {
          summary: "Token Metadata",
          description: "Returns ERC-20 metadata. Requires x402 payment.",
          parameters: [
            {
              name: "token",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Base ERC-20 token address",
              example: "0x940181a94A35A4569E4529A3CDfB74e38FD98631"
            }
          ],
          responses: {
            "200": {
              description: "Successful metadata result",
              content: { "application/json": { schema: metadataOutputSchema } }
            },
            "402": {
              description: "Payment Required."
            }
          }
        }
      },
      "/v1/metadatas": {
        get: {
          summary: "Batch Token Metadata",
          description: "Batch endpoint for Base ERC-20 token metadata. Requires x402 payment.",
          parameters: [
            {
              name: "tokens",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Comma-separated list of Base ERC-20 token addresses"
            }
          ],
          responses: {
            "200": {
              description: "Successful batch metadata result",
              content: { "application/json": { schema: metadatasOutputSchema } }
            },
            "402": {
              description: "Payment Required."
            }
          }
        }
      }
    }
  })
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

app.get('/v1/cache/metrics', adminAuthMiddleware, async (c) => {
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

  const engine = buildPricingEngine(c.env, chain, defaultTTL);

  let finalResponse
  try {
    finalResponse = await engine.calculatePrice(token);
  } catch (error) {
    if (isPricingError(error)) {
      // We could not establish an input we depend on. Refuse rather than
      // returning a number we cannot stand behind.
      return c.json({ error: error.code, message: error.message }, 503);
    }
    throw error;
  }

  if (!finalResponse) {
     return c.json({ error: 'not_found', message: 'No pools found or un-priceable' }, 404);
  }

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

  const maxTokens = c.env?.MAX_BATCH_TOKENS ? parseInt(c.env.MAX_BATCH_TOKENS) : 50
  if (tokens.length > maxTokens) {
    return c.json({ error: 'invalid_request', message: `Maximum ${maxTokens} tokens allowed per request` }, 400)
  }

  const defaultTTL = c.env?.CACHE_DEFAULT_TTL_SECONDS
    ? Math.max(60, parseInt(c.env.CACHE_DEFAULT_TTL_SECONDS) || 60)
    : 60

  if (!c.env?.PRICE_RPC_URL) {
    return c.json({ error: 'server_error', message: 'PRICE_RPC_URL is not configured on the server' }, 500)
  }

  if (c.env?.PRICE_CHAIN_ID !== '8453') {
    return c.json({ error: 'server_error', message: 'PRICE_CHAIN_ID must be configured as 8453 for Base mainnet reads' }, 500)
  }

  const cacheLayer = new KVCacheLayer(c.env?.FATHOM_KV, defaultTTL)

  // One engine for the whole batch: one set of adapters, one RPC client, one
  // shared WETH/USD anchor. This used to be rebuilt from scratch per token.
  const engine = buildPricingEngine(c.env, chain, defaultTTL)

  const results = await mapWithConcurrency(tokens, BATCH_CONCURRENCY, async (token): Promise<BatchPriceResult> => {
    try {
      const cachedResponse = await cacheLayer.get(token, chain)
      if (cachedResponse) {
        return { ...cachedResponse, status: "ok" }
      }

      const finalResponse = await engine.calculatePrice(token);

      if (!finalResponse) {
        return { token, status: "no_liquidity", error: { code: "no_liquidity", message: "No usable liquidity found or unpriceable" } };
      }

      c.executionCtx.waitUntil(cacheLayer.set(token, chain, finalResponse))
      return { ...finalResponse, status: "ok" }
    } catch (error) {
      console.error(`Error pricing token ${token}:`, error);
      if (isPricingError(error)) {
        return { token, status: error.code, error: { code: error.code, message: error.message } };
      }
      return { token, status: "rpc_error", error: { code: "rpc_error", message: "RPC or provider failure" } };
    }
  })

  const priced = results.filter(r => r.status === "ok").length
  const failed = results.length - priced

  const batchResponse: BatchPriceResponse = {
    chain,
    count: tokens.length,
    priced,
    failed,
    results
  };

  return c.json(batchResponse)
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
