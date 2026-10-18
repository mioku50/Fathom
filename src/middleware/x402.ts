import { createMiddleware } from 'hono/factory'
import type { FathomEnv } from '../cache'
import { HonoAdapter, paymentMiddlewareFromConfig } from '@x402/hono'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from '@x402/core/http'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import type { RouteConfig } from '@x402/core/server'
import type { ResourceInfo } from '@x402/core/types'
import { declareDiscoveryExtension } from '@x402/extensions'
import { bazaarResourceServerExtension } from '@x402/extensions/bazaar'
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
function createFacilitatorCompatiblePaymentSignature(
  value: string,
  resourceInfo: ResourceInfo,
  declaredExtensions: Record<string, unknown>
) {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4)
  const paymentPayload = decodePaymentSignatureHeader(padded) as any

  if (paymentPayload.x402Version === 2) {
    // Bazaar needs BOTH resource and extensions.bazaar on verify/settle. The
    // old workaround dropped resource to hide an over-500-character description
    // rejected by CDP; that allowed payments but made discovery impossible.
    // Rebuild metadata from this route, never from client-supplied catalog text.
    // These fields are outside the signed EIP-3009 authorization.
    paymentPayload.resource = resourceInfo
    const extensions = isRecord(paymentPayload.extensions) ? { ...paymentPayload.extensions } : {}
    delete extensions.bazaar
    if (declaredExtensions.bazaar) {
      extensions.bazaar = declaredExtensions.bazaar
    }

    const declaredBuilderCode = declaredExtensions[BUILDER_CODE]
    if (isRecord(declaredBuilderCode)) {
      const existing = isRecord(extensions[BUILDER_CODE]) ? extensions[BUILDER_CODE] : {}
      const existingInfo = isRecord(existing.info) ? existing.info : {}
      extensions[BUILDER_CODE] = {
        ...existing,
        ...declaredBuilderCode,
        info: { ...existingInfo, ...declaredBuilderCode.info }
      }
    }
    paymentPayload.extensions = extensions
  }

  return encodePaymentSignatureHeader(paymentPayload)
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

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

  const routes: Record<string, RouteConfig> = {
      "/v1/assess": {
          resource: resource('/v1/assess'),
          serviceName: "Fathom",
          accepts: [baseAccepts],
          description: "Exit-liquidity and price-trust assessment for a Base ERC-20 token at a requested USD position size. On-chain sell quotes cover Aerodrome, Slipstream, and Uniswap V2/V3/V4. Returns tradeable, caution, illiquid, or unverified with executable proceeds, price impact, confidence, concerns, and unmeasured checks. Inputs: token address and size_usd.",
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
                          },
                          asset_type: "erc20"
                      }
                  }
              }, assessOutputSchema)
          }
      },
      "/v1/price": {
          resource: resource('/v1/price'),
          serviceName: "Fathom",
          accepts: [baseAccepts],
          description: "Base ERC-20 price and exit-liquidity measurements across Aerodrome, Slipstream, and Uniswap V2/V3/V4. Returns spot price, independent pool agreement, TWAP deviation, executable $1k/$5k/$10k sell quotes, price impact, confidence, and risk flags. Unavailable measurements are explicit; concentrated-liquidity balances are null. Input: token address.",
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
          serviceName: "Fathom",
          accepts: [batchAccepts],
          description: "Batch price and exit-liquidity measurements for up to 50 Base ERC-20 tokens. Returns spot prices across five DEXes, TWAP deviation, executable $1k/$5k/$10k sell quotes, price impact, confidence, and risk flags. Each token has its own status when measurement is unavailable. Input: comma-separated token addresses.",
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
          serviceName: "Fathom",
          accepts: [baseAccepts],
          description: "On-chain identity for one Base ERC-20 token: address, symbol, name, and decimals read from the token contract. Input: token address.",
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
          serviceName: "Fathom",
          accepts: [batchAccepts],
          description: "On-chain identity for up to 50 Base ERC-20 tokens: address, symbol, name, and decimals read from each token contract. Input: comma-separated token addresses.",
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
          serviceName: "Fathom",
          accepts: [baseAccepts],
          extensions: builderCodeExtension
      }
  }

  const paymentSignature = c.req.header('PAYMENT-SIGNATURE')
  const originalHeader = c.req.header.bind(c.req)
  let paymentHeaderOverridden = false
  if (paymentSignature) {
    try {
      const route = routes[c.req.path] ?? routes['*']
      const declaredExtensions = { ...route.extensions }
      if (declaredExtensions.bazaar) {
        // Use the same native enrichment as @x402/hono so the restored echo
        // has exactly the method/schema the SDK advertises in its challenge.
        declaredExtensions.bazaar = bazaarResourceServerExtension.enrichDeclaration!(
          declaredExtensions.bazaar,
          { adapter: new HonoAdapter(c), method: c.req.method, path: c.req.path, routePattern: c.req.path }
        )
      }
      const compatible = createFacilitatorCompatiblePaymentSignature(paymentSignature, {
        url: route.resource!,
        description: route.description ?? '',
        mimeType: route.mimeType ?? '',
        serviceName: route.serviceName,
        ...(route.tags !== undefined ? { tags: route.tags } : {})
      }, declaredExtensions)
      // Cloudflare Request headers are immutable. Shadow HonoRequest.header()
      // for this request; the SDK adapter reads through this API.
      ;(c.req as any).header = (name?: string) => {
        if (name?.toLowerCase() === 'payment-signature') return compatible
        return originalHeader(name as any)
      }
      paymentHeaderOverridden = true
    } catch {
      // Let the official middleware handle malformed headers and return 402.
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
