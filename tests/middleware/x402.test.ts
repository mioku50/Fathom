import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { x402Middleware } from '../../src/middleware/x402'
import type { FathomEnv } from '../../src/cache'

describe('x402Middleware', () => {
  let app: Hono<{ Bindings: FathomEnv }>

  beforeEach(() => {
    app = new Hono<{ Bindings: FathomEnv }>()
    app.use('*', x402Middleware)
    app.get('/', (c) => c.json({ success: true }))
  })

  const testEnv = { 
    FATHOM_X402_FACILITATOR_URL: 'http://mock',
    X402_NETWORK: 'base-sepolia',
    X402_PRICE_USDC: '0.01',
    FATHOM_X402_RECIPIENT: '0x123'
  } as any

  it('should return 402 if no Payment-Signature or Authorization headers are provided', async () => {
    const req = new Request('http://localhost/')
    const res = await app.fetch(req, testEnv)
    expect(res.status).toBe(402)
  })

  it('should return 402 for invalid Payment-Signature header format', async () => {
    const req = new Request('http://localhost/', { headers: { 'Payment-Signature': 'invalid' } })
    const res = await app.fetch(req, testEnv)
    expect(res.status).toBe(402)
  })

  beforeEach(() => {
    // Only mock /supported to allow the challenge generation, but never /verify!
    global.fetch = vi.fn().mockImplementation((url: any) => {
      if (url.toString().includes('supported')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', asset: 'usdc' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
  })

  it('unpaid /v1/price?token=AERO still returns 402 and includes discovery metadata', async () => {
    const req = new Request('http://localhost/v1/price?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631')
    const res = await app.fetch(req, testEnv)
    expect(res.status).toBe(402)

    const reqHeader = res.headers.get('Payment-Required') || res.headers.get('payment-required')
    expect(reqHeader).toBeTruthy()
    const payload = JSON.parse(Buffer.from(reqHeader!, 'base64').toString('utf8'))
    
    expect(payload).toHaveProperty('accepts')
    expect(payload).toHaveProperty('resource')
    expect(payload.resource).toHaveProperty('description')
    // Assert what the description has to convey, not how it is worded: agents
    // select on these, and pinning the prose makes every rewrite a test failure.
    const priceDescription = payload.resource.description as string
    for (const claim of ['Base', 'price', 'sell', 'impact']) {
      expect(priceDescription.toLowerCase()).toContain(claim.toLowerCase())
    }
    expect(payload.resource.tags).toEqual(expect.arrayContaining(['base', 'exit-liquidity', 'price-impact']))
    
    expect(payload).toHaveProperty('extensions')
    expect(payload.extensions).toHaveProperty('bazaar')
    expect(payload.extensions.bazaar).toHaveProperty('info')
    expect(payload.extensions.bazaar.info.input.queryParams.token).toBe('0x940181a94A35A4569E4529A3CDfB74e38FD98631')
  })

  it('unpaid /v1/metadata?token=AERO still returns 402 and includes discovery metadata', async () => {
    const req = new Request('http://localhost/v1/metadata?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631')
    const res = await app.fetch(req, testEnv)
    expect(res.status).toBe(402)
    
    const reqHeader = res.headers.get('Payment-Required') || res.headers.get('payment-required')
    const payload = JSON.parse(Buffer.from(reqHeader!, 'base64').toString('utf8'))
    
    const metadataDescription = payload.resource.description as string
    for (const claim of ['Base', 'ERC-20', 'decimals', 'symbol']) {
      expect(metadataDescription.toLowerCase()).toContain(claim.toLowerCase())
    }
    expect(payload.extensions.bazaar.info.input.queryParams.token).toBe('0x940181a94A35A4569E4529A3CDfB74e38FD98631')
  })

  it('admin/cache endpoints are not included in discovery metadata', async () => {
    const req = new Request('http://localhost/v1/cache/clear')
    const res = await app.fetch(req, testEnv)
    expect(res.status).toBe(402)
    
    const reqHeader = res.headers.get('Payment-Required') || res.headers.get('payment-required')
    const payload = JSON.parse(Buffer.from(reqHeader!, 'base64').toString('utf8'))
    
    // Fallback "*" route does not have a description, so it defaults to ""
    expect(payload.resource.description).toBe('')
    expect(payload).not.toHaveProperty('extensions')
  })
})

describe('the resource it advertises', () => {
  let app: Hono<{ Bindings: FathomEnv }>

  const env = {
    FATHOM_X402_FACILITATOR_URL: 'http://mock',
    X402_NETWORK: 'base-sepolia',
    X402_PRICE_USDC: '0.01',
    FATHOM_X402_RECIPIENT: '0x123'
  } as any

  const challenge = async (url: string) => {
    const res = await app.fetch(new Request(url), env)
    expect(res.status).toBe(402)
    const header = res.headers.get('PAYMENT-REQUIRED') || res.headers.get('payment-required')
    return JSON.parse(Buffer.from(header!, 'base64').toString('utf8'))
  }

  beforeEach(() => {
    app = new Hono<{ Bindings: FathomEnv }>()
    app.use('*', x402Middleware)
    app.get('/v1/price', (c) => c.json({ ok: true }))
    app.get('/v1/assess', (c) => c.json({ ok: true }))
  })

  it('names the endpoint, not the request that happened to hit it', async () => {
    const payload = await challenge(
      'https://fathom.test/v1/price?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631&chain=base'
    )

    // A resource string that changes with every token is a different resource
    // on every call. Not one entry in the CDP Bazaar index carries a query
    // string; the parameters belong in the extension's input schema instead.
    expect(payload.resource.url).toBe('https://fathom.test/v1/price')
    expect(payload.resource.url).not.toContain('?')
  })

  it('leaves a query-free resource alone', async () => {
    const payload = await challenge('https://fathom.test/v1/price')
    expect(payload.resource.url).toBe('https://fathom.test/v1/price')
  })

  it('still declares the query parameters in the extension', async () => {
    const payload = await challenge(
      'https://fathom.test/v1/assess?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631'
    )
    expect(payload.extensions.bazaar.info.input.queryParams).toHaveProperty('token')
  })
})
