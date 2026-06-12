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



  it('should proceed and return 200 if facilitator returns OK', async () => {
    global.fetch = vi.fn().mockImplementation((url: any, options: any) => {
      const urlStr = url.toString()
      if (urlStr.includes('supported') || urlStr.includes('kinds')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', asset: 'usdc' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (urlStr.includes('verify')) {
        return Promise.resolve(new Response(JSON.stringify({ isValid: true, payer: '0xabc' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true, transaction: '0x123', network: 'eip155:84532' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    const mockHeader = 'eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19'
    const req = new Request('http://localhost/', { headers: { 'Payment-Signature': mockHeader } })
    const env = { FATHOM_X402_FACILITATOR_URL: 'http://mock-facilitator', FATHOM_X402_RECIPIENT: '0x123' } as any
    const res = await app.fetch(req, env)
    expect(res.status).toBe(200)
  })

  it('should return 402 if facilitator verification fails', async () => {
    global.fetch = vi.fn().mockImplementation((url: any, options: any) => {
      const urlStr = url.toString()
      if (urlStr.includes('supported') || urlStr.includes('kinds')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (urlStr.includes('verify')) {
        return Promise.resolve(new Response(JSON.stringify({ isValid: true, payer: '0xabc' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        isValid: false,
        invalidReason: "invalid",
        invalidMessage: "invalid"
      }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    })
    const mockHeader = 'eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19'
    const req = new Request('http://localhost/', { headers: { 'Payment-Signature': mockHeader } })
    const env = { FATHOM_X402_FACILITATOR_URL: 'http://mock-facilitator', FATHOM_X402_RECIPIENT: '0x123' } as any
    const res = await app.fetch(req, env)
    expect(res.status).toBe(402)
  })

  it('should proceed and return 200 if Authorization header is provided', async () => {
    const req = new Request('http://localhost/', { headers: { 'Authorization': 'Bearer token' } })
    const res = await app.fetch(req)
    expect(res.status).toBe(200)
  })
})
