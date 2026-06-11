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
        body: JSON.stringify({ transactionHash: txHash, txHash })
      })
      if (!response.ok) {
        const status = response.status;
        let responseBody = '';
        let sanitizedErrorMsg = 'Payment verification failed';
        let errorCode = 'payment_required';
        try {
          responseBody = await response.text();
          const parsed = JSON.parse(responseBody);
          if (parsed.error && parsed.error.message) {
            sanitizedErrorMsg = parsed.error.message;
          } else if (parsed.message) {
            sanitizedErrorMsg = parsed.message;
          }
          if (parsed.error && parsed.error.code) {
             errorCode = parsed.error.code;
          }
        } catch (e) {
          responseBody = responseBody.slice(0, 200);
        }
        console.error(`X402 Verification Failed: Facilitator HTTP ${status}`);
        console.error(`X402 Verification Failed: ${sanitizedErrorMsg}`);
        return c.json({ error: { code: errorCode, message: `Payment verification failed: ${sanitizedErrorMsg} (HTTP ${status})` } }, 402)
      }
    } catch (error) {
      console.error('FETCH ERROR:', error);
      return c.json({ error: { code: 'internal_error', message: 'Error verifying payment' } }, 500)
    }
  }

  await next()
})
