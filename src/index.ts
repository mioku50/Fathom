import { Hono } from 'hono'
import type { PriceResponse, BatchPriceResponse, BatchPriceResult } from './schema'
import { KVCacheLayer, type FathomEnv, getCacheStats } from './cache'
import { Address } from 'viem'
import { x402Middleware } from './middleware/x402'
import { validateAddressesMiddleware, validateChainMiddleware } from './middleware/validation'
import { adminAuthMiddleware } from './middleware/adminAuth'
import { stringifyWithBigInt, parseWithBigInt } from './utils/json_bigint'
import { rateLimitMiddleware } from './middleware/rate_limit'
import { getTokenMetadata, getBatchTokenMetadata, type TokenMetadata } from './api/metadata'
import { DEXOrchestrator, type CacheLayer } from './orchestrator'
import { AerodromeAdapter } from './adapters/aerodrome'
import { AerodromeSlipstreamAdapter } from './adapters/aerodrome_slipstream'
import { UniswapV2Adapter } from './adapters/uniswap_v2'
import { UniswapV3Adapter } from './adapters/uniswap_v3'
import { UniswapV4Adapter } from './adapters/uniswap_v4'
import { syncDemandedV4PoolIndexes } from './adapters/uniswap_v4_index'
import { PricingEngine } from './pricing_engine'
import { PriceRpcClient } from './utils/price_rpc'
import { parseTokensParam } from './utils'
import { validateEnv } from './utils/env'
import { isPricingError } from './errors'
import { mapWithConcurrency } from './concurrency'
import { runSmokeChecks, SMOKE_KV_KEY, type SmokeResult } from './smoke'

/**
 * Tokens priced in parallel within one batch request.
 *
 * Each token now costs several multicalls across five DEXes, so eight at once
 * was enough to throttle the provider and come back with fewer sources - a
 * quietly thinner answer rather than a slower one. For an oracle that trade is
 * the wrong way round, so this is deliberately conservative.
 */
const BATCH_CONCURRENCY = 4

/**
 * The sale size /v1/assess judges when the caller does not name one. $10k is
 * the size the standard profile has always headlined.
 */
const DEFAULT_ASSESS_SIZE_USD = 10000
/** Below this a quote rounds to nothing; above it, no Base long-tail pool is honest. */
const MIN_ASSESS_SIZE_USD = 1
const MAX_ASSESS_SIZE_USD = 10_000_000

/**
 * KV for the orchestrator, encoded so bigint survives the round trip.
 *
 * Pool state is bigint, and plain `JSON.stringify` throws on it. This class
 * used to swallow that throw in a bare `catch {}`, so the raw-pool cache
 * silently stored nothing at all while reporting success - every request paid
 * full RPC cost for pools it had already read moments earlier. Failures are now
 * logged rather than discarded, because a cache that fails quietly is worse
 * than no cache: it hides the load it was added to remove.
 */
class OrchestratorCacheAdapter implements CacheLayer {
  constructor(private kv?: KVNamespace, private defaultTTL: number = 60) {}
  async get(key: string): Promise<any> {
    if (!this.kv) return null;
    try {
      const raw = await this.kv.get(key, 'text');
      return raw === null ? null : parseWithBigInt(raw);
    } catch (error) {
      console.error(`Cache read failed for ${key}:`, error);
      return null;
    }
  }
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.kv) return;
    try {
      await this.kv.put(key, stringifyWithBigInt(value), {
        expirationTtl: ttlSeconds || this.defaultTTL
      });
    } catch (error) {
      console.error(`Cache write failed for ${key}:`, error);
    }
  }
}

/**
 * Builds the pricing stack for one request. Every adapter shares a single RPC
 * client, and the returned engine memoizes its WETH/USD anchor, so a batch pays
 * for both once rather than once per token.
 */
function buildPricingEngine(env: ExtendedEnv, chain: string, defaultTTL: number): PricingEngine {
  // Token decimals are immutable, so they are cached across requests rather
  // than re-read every time - one fewer RPC call per token, and one fewer way
  // for a throttled provider to fail a whole token.
  const rpcClient = new PriceRpcClient(
    env.PRICE_RPC_URL!,
    env.PRICE_RPC_FALLBACK_URLS,
    new OrchestratorCacheAdapter(env.FATHOM_KV, defaultTTL)
  )
  // Base's public RPC permits 10,000-block log windows. Keeping event indexing
  // separate prevents a provider configured for pricing (often capped at 2k)
  // from turning custom-hook discovery into thousands of tiny requests.
  const v4IndexClient = new PriceRpcClient(env.V4_INDEX_RPC_URL || 'https://mainnet.base.org')
  const adapters = [
    new AerodromeAdapter(env.PRICE_RPC_URL!, env.PRICE_RPC_FALLBACK_URLS, env.PIN_BLOCK, rpcClient),
    new AerodromeSlipstreamAdapter(env.PRICE_RPC_URL!, env.PRICE_RPC_FALLBACK_URLS, env.PIN_BLOCK, rpcClient),
    new UniswapV2Adapter(env.PRICE_RPC_URL!, env.PRICE_RPC_FALLBACK_URLS, env.PIN_BLOCK, rpcClient),
    new UniswapV3Adapter(env.PRICE_RPC_URL!, env.PRICE_RPC_FALLBACK_URLS, env.PIN_BLOCK, rpcClient),
    new UniswapV4Adapter(
      env.PRICE_RPC_URL!,
      env.PRICE_RPC_FALLBACK_URLS,
      env.PIN_BLOCK,
      rpcClient,
      env.FATHOM_KV,
      v4IndexClient
    )
  ]
  const orchestrator = new DEXOrchestrator(adapters, new OrchestratorCacheAdapter(env.FATHOM_KV, defaultTTL))
  return new PricingEngine(orchestrator, rpcClient, chain)
}

type ExtendedEnv = FathomEnv & {
  BASE_RPC_URL?: string; // Kept for metadata compatibility if needed
  PRICE_RPC_URL?: string;
  PRICE_CHAIN_ID?: string;
  PIN_BLOCK?: string;
  V4_INDEX_RPC_URL?: string;
  X402_NETWORK?: string;
};

const app = new Hono<{ Bindings: ExtendedEnv }>()

import {
  assessInputSchema, assessOutputSchema,
  priceInputSchema, priceOutputSchema,
  pricesInputSchema, pricesOutputSchema,
  metadataInputSchema, metadataOutputSchema,
  metadatasInputSchema, metadatasOutputSchema
} from './schemas/x402DiscoverySchemas'
import SKILL_MD from '../SKILL.md'
import { assess, unverifiedAssessment } from './assess'

/**
 * The agent-facing entry point. Served free and unpaywalled: a capability
 * description an agent has to pay to read is one it will never read.
 */
app.get('/SKILL.md', (c) => {
  c.header('Content-Type', 'text/markdown; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=300')
  return c.body(SKILL_MD)
})

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
        <h3>Start Here — Primary Endpoint</h3>
        <ul>
            <li><code>GET <a href="/v1/assess?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631&amp;size_usd=10000">/v1/assess</a></code></li>
        </ul>
        <p>One branchable answer: can this Base token position be exited at the size you name, at a price you can trust?</p>
        <p><strong>Price:</strong> $0.001 per assessment</p>
        <p><strong>Input:</strong> One Base ERC-20 token address and position size in USD</p>
        <p><strong>Network:</strong> Base mainnet</p>
        <p><strong>Payment:</strong> USDC via x402</p>

        <h3>Public Docs / Agent Integration</h3>
        <ul>
            <li><code>GET <a href="/.well-known/x402">/.well-known/x402</a></code> - x402 Manifest</li>
            <li><code>GET <a href="/openapi.json">/openapi.json</a></code> - OpenAPI 3.1 Spec</li>
            <li><code>GET <a href="/schemas/assess.input.json">/schemas/assess.input.json</a></code> - Primary Input Schema</li>
            <li><code>GET <a href="/schemas/assess.output.json">/schemas/assess.output.json</a></code> - Primary Output Schema</li>
        </ul>
    </div>
</body>
</html>`)
})

app.get('/schemas/assess.input.json', (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate'); return c.json(assessInputSchema) })
app.get('/schemas/assess.output.json', (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate'); return c.json(assessOutputSchema) })
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
    description: "Exit-liquidity and price-trust assessments for Base tokens, paid via x402",
    version: "1.0.0",
    baseUrl: "https://fathom-api.mioku-fathom.workers.dev",
    network: "eip155:8453",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base USDC
    primaryEndpoint: "/v1/assess",
    endpoints: [
      "/v1/assess",
      "/v1/price",
      "/v1/prices",
      "/v1/metadata",
      "/v1/metadatas"
    ],
    pricing: {
      "/v1/assess": "$0.001",
      "/v1/price": "$0.001",
      "/v1/prices": "$0.003",
      "/v1/metadata": "$0.001",
      "/v1/metadatas": "$0.003"
    },
    maxBatchTokens: 50,
    schemaUrls: {
      input: "/schemas/assess.input.json",
      output: "/schemas/assess.output.json"
    },
    schemas: {
      "/v1/assess": { input: "/schemas/assess.input.json", output: "/schemas/assess.output.json" },
      "/v1/price": { input: "/schemas/price.input.json", output: "/schemas/price.output.json" },
      "/v1/prices": { input: "/schemas/prices.input.json", output: "/schemas/prices.output.json" },
      "/v1/metadata": { input: "/schemas/metadata.input.json", output: "/schemas/metadata.output.json" },
      "/v1/metadatas": { input: "/schemas/metadatas.input.json", output: "/schemas/metadatas.output.json" }
    },
    tags: ["base", "x402", "token-assessment", "exit-liquidity", "price-trust", "dex", "agents", "wallets", "trading"]
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
      "/v1/assess": {
        get: {
          summary: "Assess whether a Base token position can be exited",
          description: "Primary agent endpoint. Quotes the exact position size on chain and returns one branchable verdict: tradeable, caution, illiquid, or unverified. Requires x402 payment.",
          parameters: [
            {
              name: "token",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Base ERC-20 token address",
              example: "0x940181a94A35A4569E4529A3CDfB74e38FD98631"
            },
            {
              name: "size_usd",
              in: "query",
              required: false,
              schema: { type: "number", minimum: MIN_ASSESS_SIZE_USD, maximum: MAX_ASSESS_SIZE_USD, default: DEFAULT_ASSESS_SIZE_USD },
              description: "Position size to quote on chain, in USD"
            },
            {
              name: "chain",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["base"], default: "base" }
            }
          ],
          responses: {
            "200": {
              description: "Successful, measured assessment",
              content: { "application/json": { schema: assessOutputSchema } }
            },
            "402": {
              description: "Payment Required - Follow x402 protocol instructions to pay 0.001 USDC."
            },
            "503": {
              description: "No reliable measurement was established. The response is unverified, not a negative finding."
            }
          }
        }
      },
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
  // These counters live in one Worker isolate's memory. They are useful when
  // reproducing something locally and meaningless as a fleet-wide metric, so
  // the response says so rather than letting a caller assume otherwise.
  return c.json({
    ...getCacheStats(),
    scope: 'single_isolate',
    note: 'Per-isolate counters, reset on eviction. Not a fleet-wide metric.'
  })
})

app.get('/v1/admin/smoke', adminAuthMiddleware, async (c) => {
  if (!c.env?.FATHOM_KV) {
    return c.json({ error: 'internal_error', message: 'KV not configured' }, 500)
  }
  const last = await c.env.FATHOM_KV.get(SMOKE_KV_KEY, 'json')
  if (!last) {
    return c.json({ error: 'not_found', message: 'No scheduled run recorded yet' }, 404)
  }
  return c.json(last)
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


/**
 * The decision endpoint.
 *
 * Same measurement as /v1/price, quoted at the size the caller actually holds,
 * reduced to one verdict they can branch on. `size_usd` is priced on chain
 * rather than interpolated between the standard quotes, because a guess about
 * slippage is the one thing this service will not sell.
 */
app.get('/v1/assess', validateAddressesMiddleware, validateChainMiddleware, x402Middleware, async (c) => {
  const token = c.req.query('token') || '0x0000000000000000000000000000000000000000'
  const chain = c.req.query('chain') || 'base'

  const sizeParam = c.req.query('size_usd')
  let sizeUsd = DEFAULT_ASSESS_SIZE_USD
  if (sizeParam !== undefined) {
    const parsed = Number(sizeParam)
    if (!Number.isFinite(parsed) || parsed < MIN_ASSESS_SIZE_USD || parsed > MAX_ASSESS_SIZE_USD) {
      return c.json({
        error: 'invalid_request',
        message: `size_usd must be a number between ${MIN_ASSESS_SIZE_USD} and ${MAX_ASSESS_SIZE_USD}`
      }, 400)
    }
    sizeUsd = parsed
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

  const engine = buildPricingEngine(c.env, chain, defaultTTL)

  let price
  try {
    price = await engine.calculatePrice(token, [sizeUsd])
  } catch (error) {
    if (isPricingError(error)) {
      return c.json({ error: error.code, message: error.message }, 503)
    }
    throw error
  }

  if (!price) {
    // An answer that contains no measurement is useful for branching, but is
    // not a successful paid result. 503 keeps x402 from settling the live
    // authorization while the body still says exactly what is unknown.
    return c.json(unverifiedAssessment(token, chain, sizeUsd), 503)
  }

  return c.json(assess(price, sizeUsd))
})

app.get('/v1/price', validateAddressesMiddleware, validateChainMiddleware, x402Middleware, async (c) => {
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
     return c.json({
       error: 'unpriceable',
       message: 'No supported price source could be measured. This does not establish that the token has no pool or liquidity.'
     }, 503);
  }

  c.executionCtx.waitUntil(cacheLayer.set(token, chain, finalResponse))
  return c.json(finalResponse)
})

app.get('/v1/prices', validateAddressesMiddleware, validateChainMiddleware, x402Middleware, async (c) => {
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
        return {
          token,
          status: "unpriceable",
          error: {
            code: "unpriceable",
            message: "No supported price source could be measured; pool absence was not established"
          }
        };
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

app.get('/v1/metadata', validateAddressesMiddleware, validateChainMiddleware, x402Middleware, async (c) => {
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


app.get('/v1/metadatas', validateAddressesMiddleware, validateChainMiddleware, x402Middleware, async (c) => {
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

async function scheduled(_event: ScheduledEvent, env: ExtendedEnv, ctx: ExecutionContext) {
  if (!env?.PRICE_RPC_URL || env.PRICE_CHAIN_ID !== '8453') {
    console.error('[smoke] skipped: price RPC is not configured for Base mainnet')
    return
  }

  if (env.FATHOM_KV) {
    try {
      const rpc = new PriceRpcClient(env.V4_INDEX_RPC_URL || 'https://mainnet.base.org')
      const indexed = await syncDemandedV4PoolIndexes(env.FATHOM_KV, rpc)
      console.log(JSON.stringify({
        event: 'v4_pool_index',
        status: indexed ? 'advanced' : 'idle',
        ...(indexed ? {
          token: indexed.meta.token,
          fromBlock: indexed.fromBlock,
          toBlock: indexed.toBlock,
          pools: indexed.keys.length,
          complete: indexed.complete
        } : {})
      }))
    } catch (error) {
      // A stale index makes the v4 adapter fail closed, so this alert is a
      // coverage incident rather than a reason to stop the independent smoke.
      console.error('[v4-index] FAILED', error)
    }
  }

  const result: SmokeResult = await runSmokeChecks(() => buildPricingEngine(env, 'base', 60))

  // Structured so Workers observability can be queried on it.
  const line = JSON.stringify({ event: 'smoke', ...result })
  if (result.ok) {
    console.log(line)
  } else {
    // Error level is what a Cloudflare alert policy watches for.
    console.error(`[smoke] FAILED ${line}`)
  }

  if (env.FATHOM_KV) {
    ctx.waitUntil(
      env.FATHOM_KV.put(SMOKE_KV_KEY, JSON.stringify(result), { expirationTtl: 86400 })
        .catch(e => console.error('[smoke] could not record result:', e))
    )
  }
}

/** The Hono app itself, for tests that use its request() helper. */
export { app }

export default {
  fetch: (request: Request, env: ExtendedEnv, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled
}
