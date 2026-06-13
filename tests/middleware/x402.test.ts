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

  it('should return 402 if no Payment-Signature or Authorization headers are provided', async () => {
    const req = new Request('http://localhost/')
    const res = await app.fetch(req, { FATHOM_X402_FACILITATOR_URL: 'http://mock' } as any)
    expect(res.status).toBe(402)
  })

  it('should return 402 for invalid Payment-Signature header format', async () => {
    const req = new Request('http://localhost/', { headers: { 'Payment-Signature': 'invalid' } })
    const res = await app.fetch(req, { FATHOM_X402_FACILITATOR_URL: 'http://mock' } as any)
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



  // Removed tests that mock /verify and artificially make payment pass, per user instruction.

  it('should proceed and return 200 if valid Authorization header is provided', async () => {
    const req = new Request('http://localhost/', { headers: { 'Authorization': 'Bearer my-secret' } })
    const env = { ADMIN_AUTH_TOKEN: 'my-secret' } as any
    const res = await app.fetch(req, env)
    expect(res.status).toBe(200)
  })

  it('should return 401 if invalid Authorization header is provided', async () => {
    const req = new Request('http://localhost/', { headers: { 'Authorization': 'Bearer wrong' } })
    const env = { ADMIN_AUTH_TOKEN: 'my-secret' } as any
    const res = await app.fetch(req, env)
    expect(res.status).toBe(401)
  })
})
