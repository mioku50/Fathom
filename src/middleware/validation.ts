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

/**
 * The only chain Fathom reads is Base mainnet.
 *
 * `chain` was accepted unvalidated on the price endpoints: a request for
 * `chain=ethereum` was answered with Base data, stamped `"chain": "ethereum"`,
 * and cached under its own key - a wrong answer served confidently, and a paid
 * one. The metadata endpoints already rejected it, so the API contradicted
 * itself. Rejecting is the honest response: we cannot price what we do not read.
 */
export const SUPPORTED_CHAINS = ['base'] as const;

export const validateChainMiddleware = createMiddleware(async (c, next) => {
  const chain = c.req.query('chain')
  if (chain && !SUPPORTED_CHAINS.includes(chain as (typeof SUPPORTED_CHAINS)[number])) {
    return c.json(
      {
        error: 'invalid_request',
        message: `Unsupported chain: ${chain}. Fathom reads Base mainnet only (chain=base).`
      },
      400
    )
  }

  await next()
})
