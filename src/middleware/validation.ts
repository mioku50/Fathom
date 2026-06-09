import { createMiddleware } from 'hono/factory'
import { isAddress } from 'viem'

export const validateAddressesMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.query('token')
  if (token && !isAddress(token)) {
    return c.json({ error: 'invalid_request', message: 'Invalid token address format' }, 400)
  }

  const tokensParam = c.req.query('tokens')
  if (tokensParam) {
    const tokens = tokensParam.split(',').map(t => t.trim()).filter(Boolean)
    for (const t of tokens) {
      if (!isAddress(t)) {
        return c.json({ error: 'invalid_request', message: `Invalid token address format: ${t}` }, 400)
      }
    }
  }

  await next()
})
