import { Hono } from 'hono'
import type { PriceResponse } from './schema'
import { KVCacheLayer, type FathomEnv } from './cache'

const app = new Hono<{ Bindings: FathomEnv }>()

app.get('/v1/health', (c) => {
  return c.json({ status: 'ok', service: 'fathom-api' })
})

app.get('/v1/price', async (c) => {
  const token = c.req.query('token') || '0x0000000000000000000000000000000000000000'
  const chain = c.req.query('chain') || 'base'

  const cacheLayer = new KVCacheLayer(c.env?.FATHOM_KV)

  const cachedResponse = await cacheLayer.get(token, chain)
  if (cachedResponse) {
    return c.json(cachedResponse)
  }

  const dummyResponse: PriceResponse = {
    token,
    chain,
    symbol: "DUMMY",
    price_usd: 1.0,
    price_low: 0.95,
    price_high: 1.05,
    twap_5m: 1.01,
    confidence: 85,
    label: "reliable",
    liquidity_usd: 100000,
    main_pool: {
      dex: "aerodrome",
      address: "0x123",
      fee: 0.003
    },
    flags: [],
    updated_at: new Date().toISOString()
  }

  // Cache the generated response before returning
  c.executionCtx.waitUntil(cacheLayer.set(token, chain, dummyResponse, 60))

  return c.json(dummyResponse)
})

export default app
