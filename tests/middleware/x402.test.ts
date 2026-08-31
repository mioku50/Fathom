import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { x402Middleware } from '../../src/middleware/x402'
import type { FathomEnv } from '../../src/cache'
import { validatePaymentPayload } from '@x402/core/schemas'

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
    FATHOM_X402_RECIPIENT: '0x123',
    BASE_BUILDER_CODE: 'bc_tzj2linw'
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

  it('keeps the canonical resource in the challenge but omits it for the facilitator', async () => {
    let verifyBody: any
    let settleBody: any

    global.fetch = vi.fn().mockImplementation((url: any, init?: RequestInit) => {
      const target = url.toString()
      if (target.includes('/supported')) {
        return Promise.resolve(new Response(JSON.stringify({
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', asset: 'usdc' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (target.includes('/verify')) {
        verifyBody = JSON.parse(String(init?.body))
        return Promise.resolve(new Response(JSON.stringify({
          isValid: true,
          payer: '0x1111111111111111111111111111111111111111'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (target.includes('/settle')) {
        settleBody = JSON.parse(String(init?.body))
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          payer: '0x1111111111111111111111111111111111111111',
          transaction: `0x${'1'.repeat(64)}`,
          network: 'eip155:84532',
          amount: '10000'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    const url = 'https://fathom.test/v1/assess?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631&size_usd=10000'
    const paymentRequired = await challenge(url)
    const accepted = paymentRequired.accepts[0]
    const paymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted,
      payload: {
        authorization: {
          from: '0x1111111111111111111111111111111111111111',
          to: accepted.payTo,
          value: accepted.amount,
          validAfter: '0',
          validBefore: '9999999999',
          nonce: `0x${'2'.repeat(64)}`
        },
        signature: `0x${'3'.repeat(130)}`
      }
    }

    // ResourceInfoSchema caps tags at five. A larger challenge can be served,
    // but clients that echo it create a paid payload the facilitator rejects.
    expect(paymentRequired.resource.tags).toHaveLength(5)
    expect(() => validatePaymentPayload(paymentPayload)).not.toThrow()

    const encodedPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64url')
    expect(encodedPayment).toMatch(/[-_]/)

    const res = await app.fetch(new Request(url, {
      headers: {
        // PayBox transports the JSON envelope as Base64URL. The middleware
        // normalizes it before handing it to @x402/core's Base64-only decoder.
        'PAYMENT-SIGNATURE': encodedPayment
      }
    }), env)

    expect(res.status).toBe(200)
    expect(paymentRequired.resource.url).toBe('https://fathom.test/v1/assess')
    expect(verifyBody.paymentPayload.resource).toBeUndefined()
    expect(settleBody.paymentPayload.resource).toBeUndefined()
    expect(verifyBody.paymentPayload.extensions['builder-code'].info.a).toBe('bc_tzj2linw')
    expect(settleBody.paymentPayload.extensions['builder-code'].info.a).toBe('bc_tzj2linw')
  })

  it('preserves client attribution while enforcing Fathom app attribution', async () => {
    let verifyBody: any

    global.fetch = vi.fn().mockImplementation((url: any, init?: RequestInit) => {
      const target = url.toString()
      if (target.includes('/supported')) {
        return Promise.resolve(new Response(JSON.stringify({
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', asset: 'usdc' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (target.includes('/verify')) {
        verifyBody = JSON.parse(String(init?.body))
        return Promise.resolve(new Response(JSON.stringify({
          isValid: true,
          payer: '0x1111111111111111111111111111111111111111'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (target.includes('/settle')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          payer: '0x1111111111111111111111111111111111111111',
          transaction: `0x${'1'.repeat(64)}`,
          network: 'eip155:84532',
          amount: '10000'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    const url = 'https://fathom.test/v1/assess?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631&size_usd=10000'
    const paymentRequired = await challenge(url)
    const accepted = paymentRequired.accepts[0]
    const paymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted,
      extensions: {
        'builder-code': {
          info: {
            a: 'bc_wrong_app',
            w: 'paybox_wallet',
            s: ['hermes_client']
          }
        }
      },
      payload: {
        authorization: {
          from: '0x1111111111111111111111111111111111111111',
          to: accepted.payTo,
          value: accepted.amount,
          validAfter: '0',
          validBefore: '9999999999',
          nonce: `0x${'4'.repeat(64)}`
        },
        signature: `0x${'5'.repeat(130)}`
      }
    }

    const encodedPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64url')
    const res = await app.fetch(new Request(url, {
      headers: { 'PAYMENT-SIGNATURE': encodedPayment }
    }), env)

    expect(res.status).toBe(200)
    expect(verifyBody.paymentPayload.resource).toBeUndefined()
    expect(verifyBody.paymentPayload.extensions['builder-code'].info).toEqual({
      a: 'bc_tzj2linw',
      w: 'paybox_wallet',
      s: ['hermes_client']
    })
  })
})
