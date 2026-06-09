import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { x402Middleware } from '../../src/middleware/x402'

describe('x402Middleware', () => {
  it('should return 402 Payment Required if no X-PAYMENT or Authorization headers are provided', async () => {
    const app = new Hono()
    app.use('*', x402Middleware)
    app.get('/', (c) => c.json({ success: true }))

    const req = new Request('http://localhost/')
    const res = await app.fetch(req)

    expect(res.status).toBe(402)
    const json = await res.json()
    expect(json).toEqual({
      error: {
        code: 'payment_required',
        message: 'Payment via x402 required'
      }
    })
  })

  it('should proceed and return 200 if X-PAYMENT header is provided', async () => {
    const app = new Hono()
    app.use('*', x402Middleware)
    app.get('/', (c) => c.json({ success: true }))

    const req = new Request('http://localhost/', {
      headers: {
        'X-PAYMENT': 'some_payment_token'
      }
    })
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true })
  })

  it('should proceed and return 200 if Authorization header is provided', async () => {
    const app = new Hono()
    app.use('*', x402Middleware)
    app.get('/', (c) => c.json({ success: true }))

    const req = new Request('http://localhost/', {
      headers: {
        'Authorization': 'Bearer some_token'
      }
    })
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true })
  })
})
