import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import app from '../../src/index'
import { FathomEnv } from '../../src/cache'

describe('Discovery Endpoints', () => {
  const env: Partial<FathomEnv> = {
    ADMIN_AUTH_TOKEN: 'admin-secret'
  }

  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = vi.fn().mockImplementation((url: string | URL | Request, options?: RequestInit) => {
      const urlStr = url.toString()
      if (urlStr.includes('mock-facilitator/supported')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', asset: 'usdc' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return originalFetch(url, options)
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('Should return 200 for .well-known/x402 manifest and include required fields', async () => {
    const res = await app.request('/.well-known/x402', {}, env as FathomEnv)
    expect(res.status).toBe(200)
    
    const body: any = await res.json()
    expect(body.project).toBe('Fathom')
    expect(body.x402Network).toBe('eip155:8453')
    expect(body.primaryEndpoint).toBe('/v1/prices')
    expect(body.pricing['/v1/prices']).toBe('0.003 USDC')
    expect(body.openapiUrl).toBe('/openapi.json')
    expect(body.schemaUrls.pricesInput).toBe('/schemas/v1/prices.input.json')
    expect(body.schemaUrls.pricesOutput).toBe('/schemas/v1/prices.output.json')
    
    // Ensure no secrets
    expect(JSON.stringify(body)).not.toContain('admin-secret')
  })

  it('Should return 200 for openapi.json and include v1/prices', async () => {
    const res = await app.request('/openapi.json', {}, env as FathomEnv)
    expect(res.status).toBe(200)
    
    const body: any = await res.json()
    expect(body.openapi).toBe('3.1.0')
    expect(body.paths['/v1/prices']).toBeDefined()
    expect(body.paths['/v1/prices'].get.responses['402']).toBeDefined()
    expect(body.paths['/v1/price']).toBeDefined()
    
    // Ensure no secrets
    expect(JSON.stringify(body)).not.toContain('admin-secret')
  })

  it('Should return 200 for all schema endpoints', async () => {
    const schemaEndpoints = [
      '/schemas/v1/price.input.json',
      '/schemas/v1/price.output.json',
      '/schemas/v1/prices.input.json',
      '/schemas/v1/prices.output.json',
      '/schemas/v1/metadata.input.json',
      '/schemas/v1/metadata.output.json',
      '/schemas/v1/metadatas.input.json',
      '/schemas/v1/metadatas.output.json'
    ]

    for (const endpoint of schemaEndpoints) {
      const res = await app.request(endpoint, {}, env as FathomEnv)
      expect(res.status).toBe(200)
      
      const body = await res.json()
      expect(body).toBeDefined()
      expect(JSON.stringify(body)).not.toContain('admin-secret')
    }
  })

  it('x402 payment payload for /v1/prices contains input/output schemas in extensions', async () => {
    const mockEnv = {
      ...env,
      X402_NETWORK: 'base-sepolia',
      X402_PRICE_USDC: '0.001',
      X402_PRICE_BATCH_USDC: '0.003',
      FATHOM_X402_FACILITATOR_URL: 'http://mock-facilitator',
      FATHOM_X402_RECIPIENT: '0x123',
      BASE_RPC_URL: 'http://mock-base',
      PRICE_RPC_URL: 'http://mock-price',
      PRICE_CHAIN_ID: '8453',
      CACHE_DEFAULT_TTL_SECONDS: '60'
    } as any

    const res = await app.request('/v1/prices?tokens=0x1111111111111111111111111111111111111111', {}, mockEnv)
    expect(res.status).toBe(402)
    
    const body: any = await res.json()
    
    const wwwAuth = res.headers.get('Payment-Required')
    expect(wwwAuth).toBeDefined()
    
    const decodedPayload = JSON.parse(Buffer.from(wwwAuth!, 'base64url').toString('utf-8'))
    
    // x402 protocol wraps it in extensions field
    expect(decodedPayload.extensions).toBeDefined()
    
    // Check bazaar extension
    expect(decodedPayload.extensions.bazaar).toBeDefined()
    expect(decodedPayload.extensions.bazaar.info.input.type).toBe('http')
    
    expect(decodedPayload.extensions.bazaar.schema.properties.input).toBeDefined()
    expect(decodedPayload.extensions.bazaar.schema.properties.output).toBeDefined()
    expect(decodedPayload.extensions.bazaar.schema.properties.output.type).toBe('object')
    expect(decodedPayload.extensions.bazaar.schema.required).toContain('input')
    expect(decodedPayload.extensions.bazaar.schema.required).toContain('output')
  })
})
