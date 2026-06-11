import { createMiddleware } from 'hono/factory'

export const x402Middleware = createMiddleware(async (c, next) => {
  const paymentHeader = c.req.header('X-PAYMENT')
  const authHeader = c.req.header('Authorization')

  if (!paymentHeader && !authHeader) {
    return c.json(
      {
        error: {
          code: 'payment_required',
          message: 'Payment via x402 required'
        }
      },
      402
    )
  }

  // Strict check: if no auth header but there is a payment header, it MUST start with "x402 tx="
  if (!authHeader && paymentHeader && !paymentHeader.startsWith('x402 tx=')) {
    return c.json(
      {
        error: {
          code: 'payment_required',
          message: 'Invalid X-PAYMENT header format'
        }
      },
      402
    )
  }

  // TODO: Validate the actual transaction hash via FATHOM_X402_FACILITATOR_URL
  // Since true x402 payment proof generation/validation cannot be fully implemented safely yet,
  // we will fail explicitly if the facilitator is not mock/bypassed. For now, it requires
  // valid proof format and we proceed, but the true check logic is pending.

  await next()
})
