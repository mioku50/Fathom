import { Hono } from 'hono'
import type { PriceResponse } from './schema'
import { KVCacheLayer, type FathomEnv, getCacheStats } from './cache'
import { Address } from 'viem'
import { x402Middleware } from './middleware/x402'
import { validateAddressesMiddleware } from './middleware/validation'
import { rateLimitMiddleware } from './middleware/rate_limit'
import { generateDummyResponse } from './utils'
import { getTokenMetadata } from './api/metadata'

const app = new Hono<{ Bindings: FathomEnv }>()

app.use('/v1/health', rateLimitMiddleware(60, 60000))

app.get('/v1/health', (c) => {
  return c.json({ status: 'ok', service: 'fathom-api', timestamp: new Date().toISOString() })
})

app.get('/v1/cache/stats', (c) => {
  return c.json(getCacheStats())
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

  const dummyResponse = generateDummyResponse(token, chain)

  // Cache the generated response before returning
  c.executionCtx.waitUntil(cacheLayer.set(token, chain, dummyResponse))

  return c.json(dummyResponse)
})

app.get('/v1/prices', validateAddressesMiddleware, x402Middleware, async (c) => {
  const tokensParam = c.req.query('tokens') || ''
  const chain = c.req.query('chain') || 'base'

  if (!tokensParam) {
    return c.json({ error: 'tokens parameter is required' }, 400)
  }

  const tokens = tokensParam.split(',').map(t => t.trim()).filter(Boolean)
  if (tokens.length === 0) {
    return c.json({ error: 'tokens parameter cannot be empty' }, 400)
  }

  if (tokens.length > 10) {
    return c.json({ error: 'Maximum 10 tokens allowed per request' }, 400)
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

    const dummyResponse = generateDummyResponse(token, chain)

    c.executionCtx.waitUntil(cacheLayer.set(token, chain, dummyResponse))
    results.push(dummyResponse)
  }

  return c.json(results)
})

app.post('/v1/cache/invalidate', x402Middleware, async (c) => {
  const token = c.req.query('token')
  const chain = c.req.query('chain') || 'base'

  if (!token) {
    return c.json({ error: 'token parameter is required' }, 400)
  }

  if (c.env?.FATHOM_KV) {
    const cacheLayer = new KVCacheLayer(c.env.FATHOM_KV)
    const cacheKey = cacheLayer.getCacheKey(token, chain)

    try {
      await c.env.FATHOM_KV.delete(cacheKey)
    } catch (e) {
      console.error('KV Cache delete error:', e)
      return c.json({ error: 'Failed to invalidate cache' }, 500)
    }
  }

  return c.json({ status: 'ok', message: 'Cache invalidated successfully' })
})

app.get('/v1/metadata', validateAddressesMiddleware, x402Middleware, async (c) => {
  const token = c.req.query('token') as Address
  const chain = c.req.query('chain') || 'base'

  if (chain !== 'base') {
    return c.json({ error: 'Only base chain is currently supported for metadata' }, 400)
  }

  // 24 hours TTL for metadata
  const defaultTTL = 86400
  const cacheKey = `metadata-${chain}-${token}`

  if (c.env?.FATHOM_KV) {
    const cachedResponseStr = await c.env.FATHOM_KV.get(cacheKey)
    if (cachedResponseStr) {
      try {
        const cachedResponse = JSON.parse(cachedResponseStr)
        return c.json(cachedResponse)
      } catch (e) {
        // ignore parse error and fetch fresh
      }
    }
  }

  try {
    const metadata = await getTokenMetadata(token)

    if (c.env?.FATHOM_KV) {
      c.executionCtx.waitUntil(c.env.FATHOM_KV.put(cacheKey, JSON.stringify(metadata), { expirationTtl: defaultTTL }))
    }

    return c.json(metadata)
  } catch (error) {
    return c.json({ error: 'Failed to fetch token metadata' }, 500)
  }
})

export default app
