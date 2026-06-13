import { createMiddleware } from 'hono/factory'
import type { FathomEnv } from '../cache'

export const adminAuthMiddleware = createMiddleware<{ Bindings: FathomEnv }>(async (c, next) => {
  const adminToken = c.env?.ADMIN_AUTH_TOKEN
  if (!adminToken) {
    return c.json({ error: 'internal_error', message: 'Server configuration error: missing ADMIN_AUTH_TOKEN' }, 500)
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader || authHeader !== `Bearer ${adminToken}`) {
    return c.json({ error: 'unauthorized', message: 'Invalid authorization token' }, 401)
  }

  return await next()
})
