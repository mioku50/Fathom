import { createMiddleware } from 'hono/factory'
import type { FathomEnv } from '../cache'
import { paymentMiddlewareFromConfig } from '@x402/hono'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from '@x402/core/http'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import type { RoutesConfig } from '@x402/core/server'
import { declareDiscoveryExtension } from '@x402/extensions'
import { BUILDER_CODE, declareBuilderCodeExtension } from '@x402/extensions/builder-code'
import { parseX402Config } from '../utils/x402_config'
import {
  priceInputSchema, priceOutputSchema,
  pricesInputSchema, pricesOutputSchema,
  metadataInputSchema, metadataOutputSchema,
  metadatasInputSchema, metadatasOutputSchema,
  assessInputSchema, assessOutputSchema
} from '../schemas/x402DiscoverySchemas'

/** Build the Bazaar extension in the SDK's native wire format. */
function createDiscoveryExtension(config: any, outputSchema: any) {
  return declareDiscoveryExtension({
    ...config,
    output: {
      ...config.output,
      schema: outputSchema
    }
  })
}

function createBuilderCodeExtension(env?: FathomEnv) {
  const builderCode = env?.BASE_BUILDER_CODE?.trim()
  if (!builderCode) {
    return {}
  }

  return {
    [BUILDER_CODE]: declareBuilderCodeExtension(builderCode)
  }
}

/**
 * PayBox and some x402 clients transport the JSON envelope as Base64URL.
 * @x402/core 2.24 currently accepts only the standard Base64 alphabet, so
 * normalize the transport encoding without changing the signed EIP-3009 data.
 */
function createFacilitatorCompatiblePaymentSignature(value: string) {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4)
  const paymentPayload = decodePaymentSignatureHeader(padded) as any

  // The current CDP facilitator rejects v2 PaymentPayload.resource at its API
  // schema boundary even though @x402/core 2.24 models it as optional. It is
  // not part of the EIP-3009 signature, so omitting it here preserves the
  // authorization while matching the facilitator's accepted wire shape.
  if (paymentPayload.x402Version === 2 && paymentPayload.resource) {
    delete paymentPayload.resource
  }

  return encodePaymentSignatureHeader(paymentPayload)
}

export const x402Middleware = createMiddleware<{ Bindings: FathomEnv }>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (authHeader && c.env?.ADMIN_AUTH_TOKEN && authHeader === `Bearer ${c.env.ADMIN_AUTH_TOKEN}`) {
    return next()
  }

  const paymentSignature = c.req.header('PAYMENT-SIGNATURE')
  const originalHeader = c.req.header.bind(c.req)
  let paymentHeaderOverridden = false
  if (paymentSignature) {
    try {
      const compatible = createFacilitatorCompatiblePaymentSignature(paymentSignature)
      // Cloudflare Request headers are immutable. Shadow HonoRequest.header()
      // for this request instead; @x402/hono's adapter reads through this API.
      ;(c.req as any).header = (name?: string) => {
        if (name?.toLowerCase() === 'payment-signature') {
          return compatible
        }
        return originalHeader(name as any)
      }
      paymentHeaderOverridden = true
    } catch {
      // Let the official middleware handle malformed headers and return 402.
    }
  }

  let x402Config;
  try {
    x402Config = parseX402Config(c.env)
  } catch (err: any) {
    console.error("X402_CONFIG_ERROR", err.message)
    return c.json({ error: 'config_error', message: 'Internal server config error' }, 500)
  }

  const builderCodeExtension = createBuilderCodeExtension(c.env)

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

  // RouteConfig.resource is consumed by the SDK before it creates either the
  // 402 challenge or the paid-request verification context. Keeping the query
  // out here gives both legs exactly the same resource identity while the
  // Bazaar extension continues to describe the actual query parameters.
  const origin = new URL(c.req.url).origin
  const resource = (path: string) => `${origin}${path}`

  const routes: RoutesConfig = {
      "/v1/assess": {
          resource: resource('/v1/assess'),
          accepts: [baseAccepts],
          description: "Answer one question about a Base ERC-20: can I get out of this position, at this size, at a price I can trust? Quotes the exact sale you name on chain across five DEXes - Aerodrome, Aerodrome Slipstream, Uniswap V2/V3/V4 - and returns a single verdict to branch on: tradeable, caution, illiquid, or unverified. Pass size_usd for the position you actually hold; it is priced at that size rather than interpolated between standard quotes, because a guess about slippage is worse than no answer. The response separates what is measured about the token from what could not be established about it, so a failed reading is never mistaken for a bad token. Built for agents deciding whether to enter, exit, size, or value a long-tail position on Base.",
          mimeType: "application/json",
          tags: [
            "base", "exit-liquidity", "price-impact", "risk", "trading-agent"
          ],
          extensions: {
              ...builderCodeExtension,
              ...createDiscoveryExtension({
                  input: { token: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", size_usd: 10000 },
                  inputSchema: assessInputSchema,
                  output: {
                      example: {
                          token: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
                          chain: "base",
                          verdict: "tradeable",
                          reason: "$10,000 fills at 48 bps against a price corroborated across venues.",
                          size_usd: 10000,
                          exit: {
                              fillable: true,
                              proceeds_usd: 9951.96,
                              price_impact_bps: 48.04,
                              execution_price_usd: 0.4818
                          },
                          price_trust: {
                              confidence: 96,
                              measured_weight: 0.75,
                              sources: 6,
                              dispersion_bps: 39.7,
                              twap_deviation_bps: 0.85
                          }
                      }
                  }
              }, assessOutputSchema)
          }
      },
      "/v1/price": {
          resource: resource('/v1/price'),
          accepts: [baseAccepts],
          description: "Decide whether a Base ERC-20 can be priced and exited before you trade it. Reads five DEXes on Base mainnet - Aerodrome, Aerodrome Slipstream, Uniswap V2/V3/V4 - and returns spot price cross-checked across independent pools, the pool's own TWAP against spot, and on-chain quotes for actually selling $1k, $5k and $10k with the price impact each costs. Built for long-tail tokens that major feeds either lack or quote without any sense of whether the market can absorb a sale. Every number is measured or absent: liquidity_usd is null for concentrated-liquidity pools rather than reporting L*sqrtP as a balance it is not, unmeasured components are excluded from the confidence score, and measured_weight says what share of the model that score rests on. Flags separate what is true about the token from what could not be established about it.",
          mimeType: "application/json",
          tags: [
            "base", "token-price", "exit-liquidity", "price-impact", "oracle"
          ],
          extensions: {
              ...builderCodeExtension,
              ...createDiscoveryExtension({
                  input: { token: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
                  inputSchema: priceInputSchema,
                  output: { 
                      example: { 
                          token: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
                          chain: "base",
                          status: "ok" 
                      }
                  }
              }, priceOutputSchema)
          }
      },
      "/v1/prices": {
          resource: resource('/v1/prices'),
          accepts: [batchAccepts],
          description: "Value or de-risk a whole Base portfolio in one paid call. Same measurement as /v1/price - spot cross-checked across five DEXes, TWAP against spot, executable $1k/$5k/$10k sell quotes with price impact, confidence and risk flags - for up to 50 Base ERC-20s at once. Use it to mark a book, screen a watchlist, or find which holdings cannot actually be exited at size. Each token reports its own status, so one unreadable token does not cost you the rest.",
          mimeType: "application/json",
          tags: [
            "base", "batch", "portfolio", "token-price", "risk"
          ],
          extensions: {
              ...builderCodeExtension,
              ...createDiscoveryExtension({
                  input: { tokens: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
                  inputSchema: pricesInputSchema,
                  output: { 
                      example: { 
                          chain: "base",
                          count: 1,
                          priced: 1,
                          failed: 0,
                          results: [{
                              token: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
                              chain: "base",
                              status: "ok"
                          }]
                      }
                  }
              }, pricesOutputSchema)
          }
      },
      "/v1/metadata": {
          resource: resource('/v1/metadata'),
          accepts: [baseAccepts],
          description: "Read a Base ERC-20's own identity from the chain: address, symbol, name and decimals, taken from the contract rather than from a list that can be stale or absent. Use it to resolve a token you have only an address for, before pricing it.",
          mimeType: "application/json",
          tags: ["base", "erc20", "metadata", "token", "onchain-data"],
          extensions: {
              ...builderCodeExtension,
              ...createDiscoveryExtension({
                  input: { token: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
                  inputSchema: metadataInputSchema,
                  output: { 
                      example: { 
                          address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", 
                          symbol: "AERO",
                          name: "Aerodrome",
                          decimals: 18
                      }
                  }
              }, metadataOutputSchema)
          }
      },
      "/v1/metadatas": {
          resource: resource('/v1/metadatas'),
          accepts: [batchAccepts],
          description: "Resolve many Base ERC-20s at once: address, symbol, name and decimals read from each contract. Use it to label a portfolio or a watchlist in one paid call before pricing it.",
          mimeType: "application/json",
          tags: ["base", "erc20", "metadata", "batch", "portfolio"],
          extensions: {
              ...builderCodeExtension,
              ...createDiscoveryExtension({
                  input: { tokens: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
                  inputSchema: metadatasInputSchema,
                  output: { 
                      example: { 
                          chain: "base",
                          count: 1,
                          results: [{
                              address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", 
                              symbol: "AERO",
                              name: "Aerodrome",
                              decimals: 18
                          }]
                      }
                  }
              }, metadatasOutputSchema)
          }
      },
      "*": {
          resource: resource(c.req.path),
          accepts: [baseAccepts],
          extensions: builderCodeExtension
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

    const res = await middleware(c, next)
    if (res && res.status === 402) {
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    }
    return res
  } catch (err) {
    console.error("X402_MIDDLEWARE_ERROR", err)
    throw err
  } finally {
    if (paymentHeaderOverridden) {
      delete (c.req as any).header
    }
  }
})
