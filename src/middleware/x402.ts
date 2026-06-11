import { createMiddleware } from 'hono/factory'
import type { FathomEnv } from '../cache'

export const x402Middleware = createMiddleware<{ Bindings: FathomEnv }>(async (c, next) => {
  const paymentHeader = c.req.header('X-PAYMENT')
  const authHeader = c.req.header('Authorization')

  if (!paymentHeader && !authHeader) {
    return c.json({ error: { code: 'payment_required', message: 'Payment via x402 required' } }, 402)
  }

  if (!authHeader && paymentHeader) {
    if (!paymentHeader.startsWith('x402 tx=')) {
      return c.json({ error: { code: 'payment_required', message: 'Invalid X-PAYMENT header format' } }, 402)
    }

    const txHash = paymentHeader.split('=')[1]
    const facilitatorUrl = c.env?.FATHOM_X402_FACILITATOR_URL

    if (!facilitatorUrl) {
      return c.json({ error: { code: 'internal_error', message: 'Facilitator URL not configured' } }, 500)
    }

    try {
      const response = await fetch(facilitatorUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash })
      })
      if (!response.ok) {
        return c.json({ error: { code: 'payment_required', message: 'Payment verification failed' } }, 402)
      }
    } catch (error) {
      console.error('FETCH ERROR:', error);
      return c.json({ error: { code: 'internal_error', message: 'Error verifying payment' } }, 500)
    }
  }

  await next()
})
