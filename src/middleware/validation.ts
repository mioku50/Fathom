import { createMiddleware } from 'hono/factory'
import { isAddress } from 'viem'

/**
 * Middleware to validate token addresses in API requests.
 *
 * This middleware intercepts requests and checks the `token` and `tokens` query parameters.
 * If these parameters are present, it verifies that they are valid Ethereum addresses
 * using `viem`'s `isAddress` function.
 *
 * @returns {Response} - If a single `token` or any token in the `tokens` list is invalid,
 *                       it returns a 400 Bad Request response with an `invalid_request` error.
 *                       Otherwise, it passes control to the next middleware or route handler.
 */
export const validateAddressesMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.query('token')
  if (token && !isAddress(token)) {
    console.error(`[Validation Middleware] Invalid token address format: ${token}`)
    return c.json({ error: 'invalid_request', message: 'Invalid token address format' }, 400)
  }

  const tokensParam = c.req.query('tokens')
  if (tokensParam) {
    const tokens = tokensParam.split(',').map(t => t.trim()).filter(Boolean)
    for (const t of tokens) {
      if (!isAddress(t)) {
        console.error(`[Validation Middleware] Invalid token address format in batch: ${t}`)
        return c.json({ error: 'invalid_request', message: `Invalid token address format: ${t}` }, 400)
      }
    }
  }

  await next()
})
