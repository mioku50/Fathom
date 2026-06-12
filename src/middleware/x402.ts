import { createMiddleware } from 'hono/factory'
import type { FathomEnv } from '../cache'
import { decodePaymentSignatureHeader, HTTPFacilitatorClient } from '@x402/core/http'
import { createFacilitatorConfig } from '@coinbase/x402'

export const x402Middleware = createMiddleware<{ Bindings: FathomEnv }>(async (c, next) => {
  const paymentHeader = c.req.header('X-PAYMENT') || c.req.header('PAYMENT-SIGNATURE')
  const authHeader = c.req.header('Authorization')

  // Reusable 402 error payload with x402 requirements
  const get402Response = (message: string) => {
    return c.json(
      {
        error: { code: 'payment_required', message },
      },
      402,
      {
        'PAYMENT-REQUIRED': btoa(JSON.stringify({
          x402Version: '2.0',
          resource: {
             url: c.req.url,
             method: c.req.method
          },
          accepts: [
            {
              network: 'base-sepolia',
              scheme: 'smart-contract',
              asset: 'usdc',
              amount: '10000', // 0.01 USDC
              payTo: c.env?.FATHOM_X402_RECIPIENT || '0x0000000000000000000000000000000000000000',
              maxTimeoutSeconds: 3600
            }
          ]
        }))
      }
    )
  }

  if (!paymentHeader && !authHeader) {
    return get402Response('Payment via x402 required')
  }

  if (!authHeader && paymentHeader) {
    let paymentPayload;
    try {
      paymentPayload = decodePaymentSignatureHeader(paymentHeader);
      if (!paymentPayload || !paymentPayload.x402Version) {
         throw new Error("malformed payment payload");
      }
    } catch (decodeError: any) {
      console.error('PAYMENT DECODE ERROR:', decodeError.message);
      return get402Response('Invalid or malformed X-PAYMENT header format')
    }

    const facilitatorUrl = c.env?.FATHOM_X402_FACILITATOR_URL

    if (!facilitatorUrl) {
      return c.json({ error: { code: 'internal_error', message: 'Facilitator URL not configured' } }, 500)
    }

    try {
      const config = createFacilitatorConfig(); // gets default Coinbase config
      const facilitatorClient = new HTTPFacilitatorClient({
         url: facilitatorUrl,
         createAuthHeaders: config.createAuthHeaders
      });

      // The requirements we expect them to meet
      const paymentRequirements = {
        x402Version: '2.0',
        resource: {
          url: c.req.url,
          method: c.req.method
        },
        accepts: [
          {
            network: 'base-sepolia',
            scheme: 'smart-contract',
            asset: 'usdc',
            amount: '10000', // 0.01 USDC
            payTo: c.env?.FATHOM_X402_RECIPIENT || '0x0000000000000000000000000000000000000000',
            maxTimeoutSeconds: 3600
          }
        ]
      };

      try {
         await facilitatorClient.settle(paymentPayload, paymentRequirements as any);
      } catch (settleError: any) {
        let sanitizedErrorMsg = 'Payment verification failed';
        let errorCode = 'payment_required';
        let status = 400;

        if (settleError && settleError.data) {
           sanitizedErrorMsg = settleError.data.errorMessage || settleError.data.errorReason || sanitizedErrorMsg;
           status = settleError.status || 400;
        } else if (settleError && settleError.message) {
           sanitizedErrorMsg = settleError.message;
        }

        console.error(`X402 Verification Failed: Facilitator HTTP ${status}`);
        console.error(`X402 Verification Failed: ${sanitizedErrorMsg}`);
        return get402Response(`Payment verification failed: ${sanitizedErrorMsg}`)
      }

    } catch (error: any) {
      console.error('FETCH ERROR:', error.message);
      return c.json({ error: { code: 'internal_error', message: 'Error verifying payment with facilitator' } }, 500)
    }
  }

  await next()
})
