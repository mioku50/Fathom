import { Hono } from 'hono'
import type { PriceResponse } from './schema'
import { KVCacheLayer, type FathomEnv } from './cache'
import { x402Middleware } from './middleware/x402'
import { generateDummyResponse } from './utils'

const app = new Hono<{ Bindings: FathomEnv }>()

app.get('/v1/health', (c) => {
  return c.json({ status: 'ok', service: 'fathom-api' })
})

app.get('/v1/price', x402Middleware, async (c) => {
  const token = c.req.query('token') || '0x0000000000000000000000000000000000000000'
  const chain = c.req.query('chain') || 'base'

  const cacheLayer = new KVCacheLayer(c.env?.FATHOM_KV)

  const cachedResponse = await cacheLayer.get(token, chain)
  if (cachedResponse) {
    return c.json(cachedResponse)
  }

  const dummyResponse = generateDummyResponse(token, chain)

  // Cache the generated response before returning
  c.executionCtx.waitUntil(cacheLayer.set(token, chain, dummyResponse, 60))

  return c.json(dummyResponse)
})

app.get('/v1/prices', x402Middleware, async (c) => {
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

  const cacheLayer = new KVCacheLayer(c.env?.FATHOM_KV)
  const results: PriceResponse[] = []

  for (const token of tokens) {
    const cachedResponse = await cacheLayer.get(token, chain)
    if (cachedResponse) {
      results.push(cachedResponse)
      continue
    }

    const dummyResponse = generateDummyResponse(token, chain)

    c.executionCtx.waitUntil(cacheLayer.set(token, chain, dummyResponse, 60))
    results.push(dummyResponse)
  }

  return c.json(results)
})

export default app
