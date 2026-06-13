import { createMiddleware } from 'hono/factory'
import type { FathomEnv } from '../cache'
import { paymentMiddlewareFromConfig } from '@x402/hono'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import type { RoutesConfig } from '@x402/core/server'
import { parseX402Config } from '../utils/x402_config'
import { declareDiscoveryExtension } from '@x402/extensions'

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

  const baseAccepts = {
      scheme: "exact",
      network: x402Config.network as any,
      price: x402Config.price,
      payTo: x402Config.payTo
  }

  const batchAccepts = {
      ...baseAccepts,
      price: x402Config.batchPrice || x402Config.price
  }

  const routes: RoutesConfig = {
      "/v1/price": {
          accepts: [baseAccepts],
          description: "Returns price, liquidity, confidence score, main pool, and risk flags for a Base ERC-20 token using Base mainnet DEX liquidity.",
          mimeType: "application/json",
          tags: ["base", "price", "oracle", "dex", "liquidity", "long-tail", "aero", "usdc", "agent"],
          extensions: {
              ...declareDiscoveryExtension({
                  input: { token: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" }
              })
          }
      },
      "/v1/prices": {
          accepts: [batchAccepts],
          description: "Batch pricing endpoint for Base ERC-20 token lists. Returns price, liquidity, confidence score, risk flags, and main pool data for up to 50 Base tokens in one paid x402 request.",
          mimeType: "application/json",
          tags: ["base", "batch", "price", "oracle", "liquidity", "long-tail", "agents", "wallets", "trading"],
          extensions: {
              ...declareDiscoveryExtension({
                  input: { tokens: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" }
              })
          }
      },
      "/v1/metadata": {
          accepts: [baseAccepts],
          description: "Returns ERC-20 metadata for a Base token, including address, symbol, name, and decimals.",
          mimeType: "application/json",
          tags: ["base", "erc20", "metadata", "token"],
          extensions: {
              ...declareDiscoveryExtension({
                  input: { token: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" }
              })
          }
      },
      "/v1/metadatas": {
          accepts: [batchAccepts],
          description: "Batch endpoint for Base ERC-20 token metadata.",
          mimeType: "application/json",
          tags: ["base", "erc20", "metadata", "batch"],
          extensions: {
              ...declareDiscoveryExtension({
                  input: { tokens: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" }
              })
          }
      },
      "*": {
          accepts: [baseAccepts]
      }
  }

  try {
    const middleware = paymentMiddlewareFromConfig(
      routes,
      [new HTTPFacilitatorClient({ 
        url: x402Config.facilitatorUrl,
        createAuthHeaders: x402Config.createAuthHeaders
      })],
      [{ network: x402Config.network as any, server: new ExactEvmScheme() }]
    )

    return await middleware(c, next)
  } catch (err) {
    console.error("X402_MIDDLEWARE_ERROR", err)
    throw err
  }
})
