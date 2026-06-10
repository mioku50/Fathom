import { createMiddleware } from 'hono/factory'
import type { FathomEnv } from '../cache'

/**
 * Middleware that limits the number of requests per IP address within a specified time window.
 * It uses Cloudflare KV to store the request count for a given IP and path.
 * The TTL of the KV record is refreshed on every request, creating a sliding window.
 * Note that Cloudflare KV has a minimum TTL of 60 seconds, so the actual window might
 * be longer than `windowMs` if it is set to less than 60000ms.
 *
 * @param {number} [limit=10] - The maximum number of requests allowed in the window.
 * @param {number} [windowMs=60000] - The duration of the sliding window in milliseconds.
 * @returns {import('hono').MiddlewareHandler} The Hono middleware function.
 */
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
      // Log the KV error and return 500 to prevent infinite passes
      console.error('KV Rate Limit error:', e)
      return c.json(
        { error: 'internal_error', message: 'Rate limit storage unavailable' },
        500
      )
    }

    await next()
  })
}
