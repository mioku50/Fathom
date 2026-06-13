import { createMiddleware } from 'hono/factory'
import type { FathomEnv } from '../cache'
import { paymentMiddlewareFromConfig } from '@x402/hono'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import type { RoutesConfig } from '@x402/core/server'
import { parseX402Config } from '../utils/x402_config'

export const x402Middleware = createMiddleware<{ Bindings: FathomEnv }>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (authHeader && c.env?.ADMIN_AUTH_TOKEN && authHeader === `Bearer ${c.env.ADMIN_AUTH_TOKEN}`) {
    return next()
  }

  let x402Config;
  try {
    x402Config = parseX402Config(c.env)
  } catch (err: any) {
    console.error("X402_CONFIG_ERROR", err.message)
    return c.json({ error: 'config_error', message: 'Internal server config error' }, 500)
  }

  const routes: RoutesConfig = {
      "*": {
          accepts: [{
              scheme: "exact",
              network: x402Config.network,
              price: x402Config.price,
              payTo: x402Config.payTo
          }]
      }
  }

  try {
    const middleware = paymentMiddlewareFromConfig(
      routes,
      [new HTTPFacilitatorClient({ url: x402Config.facilitatorUrl })],
      [{ network: x402Config.network, server: new ExactEvmScheme() }]
    )

    return await middleware(c, next)
  } catch (err) {
    console.error("X402_MIDDLEWARE_ERROR", err)
    throw err
  }
})
