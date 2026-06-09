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

  await next()
})
