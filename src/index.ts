import { Hono } from 'hono'
import type { PriceResponse } from './schema'
import { KVCacheLayer, type FathomEnv, getCacheStats } from './cache'
import { Address } from 'viem'
import { x402Middleware } from './middleware/x402'
import { validateAddressesMiddleware } from './middleware/validation'
import { rateLimitMiddleware } from './middleware/rate_limit'
import { generateDummyResponse } from './utils'
import { getTokenMetadata, getBatchTokenMetadata, type TokenMetadata } from './api/metadata'

const app = new Hono<{ Bindings: FathomEnv }>()

app.use('/v1/health', rateLimitMiddleware(60, 60000))

app.get('/v1/health', (c) => {
  return c.json({ status: 'ok', service: 'fathom-api', timestamp: new Date().toISOString() })
})

app.get('/v1/cache/stats', (c) => {
  return c.json(getCacheStats())
})

app.get('/v1/cache/metrics', async (c) => {
  if (!c.env?.FATHOM_KV) {
    return c.json({ error: 'Internal Server Error: KV not configured' }, 500)
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
    return c.json({ error: 'Failed to retrieve cache metrics' }, 500)
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
  const pool = c.req.query('pool')
  const chain = c.req.query('chain') || 'base'

  if (!token && !pool) {
    return c.json({ error: 'Either token or pool parameter is required' }, 400)
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
      return c.json({ error: 'Failed to invalidate cache' }, 500)
    }
  }

  return c.json({ status: 'ok', message: 'Cache invalidated successfully' })
})

app.post('/v1/cache/clear', x402Middleware, async (c) => {
  if (!c.env?.FATHOM_KV) {
    return c.json({ error: 'Internal Server Error: KV not configured' }, 500)
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
    return c.json({ error: 'Failed to clear cache' }, 500)
  }
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
    const metadata = await getTokenMetadata(token)

    if (c.env?.FATHOM_KV) {
      c.executionCtx.waitUntil(
        c.env.FATHOM_KV.put(cacheKey, JSON.stringify(metadata), { expirationTtl: defaultTTL })
          .catch(e => console.error('KV Cache write error for metadata:', e))
      )
    }

    return c.json(metadata)
  } catch (error) {
    return c.json({ error: 'Failed to fetch token metadata' }, 500)
  }
})


app.get('/v1/metadatas', validateAddressesMiddleware, x402Middleware, async (c) => {
  const tokensParam = c.req.query('tokens') || ''
  const chain = c.req.query('chain') || 'base'

  if (chain !== 'base') {
    return c.json({ error: 'Only base chain is currently supported for metadata' }, 400)
  }

  if (!tokensParam) {
    return c.json({ error: 'tokens parameter is required' }, 400)
  }

  const tokens = tokensParam.split(',').map(t => t.trim()).filter(Boolean) as Address[]
  if (tokens.length === 0) {
    return c.json({ error: 'tokens parameter cannot be empty' }, 400)
  }

  if (tokens.length > 10) {
    return c.json({ error: 'Maximum 10 tokens allowed per request' }, 400)
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
      const fetchedMetadata = await getBatchTokenMetadata(missingTokens)

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
      return c.json({ error: 'Failed to fetch batch token metadata' }, 500)
    }
  }

  return c.json(results)
})

export default app
