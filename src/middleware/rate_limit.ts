import { createMiddleware } from 'hono/factory'
import type { FathomEnv } from '../cache'

export const rateLimitMiddleware = (limit = 10, windowMs = 60000) => {
  return createMiddleware(async (c, next) => {
    // If we're not running in a Cloudflare Worker environment with KV bound, bypass rate limiting
    const env = c.env as FathomEnv
    if (!env || !env.FATHOM_KV) {
      await next()
      return
    }

    const kv = env.FATHOM_KV
    const ip = c.req.header('cf-connecting-ip') || 'unknown-ip'
    const key = `ratelimit:${ip}:${c.req.path}`

    try {
      const recordStr = await kv.get(key)
      let count = 1

      if (recordStr) {
        count = parseInt(recordStr, 10) + 1
        if (count > limit) {
          return c.json(
            { error: 'rate_limited', message: 'Too many requests' },
            429
          )
        }
      }

      // We'll update the cache count
      // Since KV doesn't have an atomic increment with TTL refresh easily available,
      // and minimum TTL is 60 seconds, we will just put the new value with the original window duration as TTL.
      // This resets the TTL on every request, making it a sliding window of inactivity.
      const ttlSeconds = Math.max(60, Math.floor(windowMs / 1000))
      c.executionCtx.waitUntil(kv.put(key, count.toString(), { expirationTtl: ttlSeconds }))
    } catch (e) {
      // Ignore KV errors to prevent breaking the API
      console.error('KV Rate Limit error:', e)
    }

    await next()
  })
}
