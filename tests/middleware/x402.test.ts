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
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('should return 402 if no X-PAYMENT or Authorization headers are provided', async () => {
    const req = new Request('http://localhost/')
    const res = await app.fetch(req)
    expect(res.status).toBe(402)
  })

  it('should return 402 for invalid X-PAYMENT header format', async () => {
    const req = new Request('http://localhost/', { headers: { 'X-PAYMENT': 'invalid' } })
    const res = await app.fetch(req)
    expect(res.status).toBe(402)
  })

  it('should return 500 if facilitator URL is not configured', async () => {
    const req = new Request('http://localhost/', { headers: { 'X-PAYMENT': 'x402 tx=mock-hash' } })
    const res = await app.fetch(req, {} as any)
    expect(res.status).toBe(500)
  })

  it('should proceed and return 200 if facilitator returns OK', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 200 }))
    const req = new Request('http://localhost/', { headers: { 'X-PAYMENT': 'x402 tx=mock-hash' } })
    const env = { FATHOM_X402_FACILITATOR_URL: 'http://mock-facilitator' } as any
    const res = await app.fetch(req, env)
    expect(res.status).toBe(200)
  })

  it('should return 402 if facilitator verification fails', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 400 }))
    const req = new Request('http://localhost/', { headers: { 'X-PAYMENT': 'x402 tx=mock-hash' } })
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
