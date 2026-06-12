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
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      success: true,
      transaction: '0x123',
      network: 'base-sepolia',
      amount: '10000',
      payer: '0xabc',
      errorReason: null,
      errorMessage: null,
      extensions: {}
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  })

  it('should return 402 if no X-PAYMENT or Authorization headers are provided', async () => {
    const req = new Request('http://localhost/')
    const res = await app.fetch(req, { FATHOM_X402_FACILITATOR_URL: 'http://mock' } as any)
    expect(res.status).toBe(402)
  })

  it('should return 402 for invalid X-PAYMENT header format', async () => {
    const req = new Request('http://localhost/', { headers: { 'X-PAYMENT': 'invalid' } })
    const res = await app.fetch(req, { FATHOM_X402_FACILITATOR_URL: 'http://mock' } as any)
    expect(res.status).toBe(402)
  })

  it('should return 500 if facilitator URL is not configured', async () => {
    const mockHeader = Buffer.from(JSON.stringify({ x402Version: '2.0', payload: { signature: 'mock' } })).toString('base64')
    const req = new Request('http://localhost/', { headers: { 'X-PAYMENT': mockHeader } })
    const res = await app.fetch(req, {} as any)
    expect(res.status).toBe(500)
  })

  it('should proceed and return 200 if facilitator returns OK', async () => {
    const mockHeader = Buffer.from(JSON.stringify({ x402Version: '2.0', payload: { signature: 'mock' } })).toString('base64')
    const req = new Request('http://localhost/', { headers: { 'X-PAYMENT': mockHeader } })
    const env = { FATHOM_X402_FACILITATOR_URL: 'http://mock-facilitator' } as any
    const res = await app.fetch(req, env)
    expect(res.status).toBe(200)
  })

  it('should return 402 if facilitator verification fails', async () => {
    vi.mocked(global.fetch).mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
      success: false,
      errorReason: "invalid",
      errorMessage: "invalid"
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })))
    const mockHeader = Buffer.from(JSON.stringify({ x402Version: '2.0', payload: { signature: 'mock' } })).toString('base64')
    const req = new Request('http://localhost/', { headers: { 'X-PAYMENT': mockHeader } })
    const env = { FATHOM_X402_FACILITATOR_URL: 'http://mock-facilitator' } as any
    const res = await app.fetch(req, env)
    expect(res.status).toBe(402)
  })

  it('should proceed and return 200 if Authorization header is provided', async () => {
    const req = new Request('http://localhost/', { headers: { 'Authorization': 'Bearer token' } })
    const res = await app.fetch(req)
    expect(res.status).toBe(200)
  })
})
