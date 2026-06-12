import { createMiddleware } from 'hono/factory'
import type { FathomEnv } from '../cache'
import { paymentMiddlewareFromConfig } from '@x402/hono'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import type { RoutesConfig } from '@x402/core/server'

export const x402Middleware = createMiddleware<{ Bindings: FathomEnv }>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  
  if (authHeader) {
    return next()
  }

  const facilitatorUrl = c.env?.FATHOM_X402_FACILITATOR_URL || 'https://api.fathom.network/facilitator'
  const payTo = c.env?.FATHOM_X402_RECIPIENT || '0x0000000000000000000000000000000000000000'

  const routes: RoutesConfig = {
      "*": {
          accepts: [{
              scheme: "exact",
              network: "eip155:84532",
              price: "$0.01",
              payTo: payTo as `0x${string}`
          }]
      }
  }

  try {
    const middleware = paymentMiddlewareFromConfig(
      routes,
      [new HTTPFacilitatorClient(facilitatorUrl)],
      [{ network: 'eip155:84532', server: new ExactEvmScheme() }]
    )

    return await middleware(c, next)
  } catch (err) {
    console.error("X402_MIDDLEWARE_ERROR", err)
    throw err
  }
})
