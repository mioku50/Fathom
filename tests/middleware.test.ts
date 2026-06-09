import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { rateLimitMiddleware } from '../src/middleware/rate_limit'
import type { FathomEnv } from '../src/cache'

describe('Rate Limit Middleware with KV', () => {
  let app: Hono<{ Bindings: FathomEnv }>
  let mockKV: any

  beforeEach(() => {
    mockKV = {
      store: new Map<string, string>(),
      get: vi.fn(async (key: string) => mockKV.store.get(key) || null),
      put: vi.fn(async (key: string, value: string) => {
        mockKV.store.set(key, value)
      })
    }

    app = new Hono<{ Bindings: FathomEnv }>()
    app.use('/test', rateLimitMiddleware(2, 60000))
    app.get('/test', (c) => c.json({ ok: true }))
  })

  it('should bypass rate limiting if FATHOM_KV is not provided', async () => {
    const req = new Request('http://localhost/test', {
      headers: { 'cf-connecting-ip': '1.1.1.1' }
    })

    // No FATHOM_KV provided
    let env = {}
    let ctx = { waitUntil: vi.fn() } as any

    await app.fetch(req, env, ctx) // 1
    await app.fetch(req, env, ctx) // 2
    const res3 = await app.fetch(req, env, ctx) // 3

    expect(res3.status).toBe(200)
  })

  it('should allow requests within the limit', async () => {
    const req1 = new Request('http://localhost/test', {
      headers: { 'cf-connecting-ip': '1.1.1.1' }
    })
    const env = { FATHOM_KV: mockKV as KVNamespace }
    const ctx = { waitUntil: vi.fn() } as any

    const res1 = await app.fetch(req1, env, ctx)
    expect(res1.status).toBe(200)

    const req2 = new Request('http://localhost/test', {
      headers: { 'cf-connecting-ip': '1.1.1.1' }
    })
    const res2 = await app.fetch(req2, env, ctx)
    expect(res2.status).toBe(200)

    expect(mockKV.get).toHaveBeenCalledTimes(2)
    expect(mockKV.put).toHaveBeenCalledTimes(2)
  })

  it('should block requests exceeding the limit', async () => {
    const req = new Request('http://localhost/test', {
      headers: { 'cf-connecting-ip': '2.2.2.2' }
    })
    const env = { FATHOM_KV: mockKV as KVNamespace }
    const ctx = { waitUntil: vi.fn((p) => p.catch(() => {})) } as any

    await app.fetch(req, env, ctx) // 1
    await app.fetch(req, env, ctx) // 2
    const res3 = await app.fetch(req, env, ctx) // 3 - should fail

    expect(res3.status).toBe(429)
    const data = await res3.json()
    expect(data).toEqual({ error: 'rate_limited', message: 'Too many requests' })
  })

  it('should track IPs separately', async () => {
    const req1 = new Request('http://localhost/test', {
      headers: { 'cf-connecting-ip': '3.3.3.3' }
    })
    const req2 = new Request('http://localhost/test', {
      headers: { 'cf-connecting-ip': '4.4.4.4' }
    })
    const env = { FATHOM_KV: mockKV as KVNamespace }
    const ctx = { waitUntil: vi.fn() } as any

    await app.fetch(req1, env, ctx) // 1 for 3.3.3.3
    await app.fetch(req1, env, ctx) // 2 for 3.3.3.3
    const res3 = await app.fetch(req1, env, ctx) // 3 for 3.3.3.3 - should fail
    expect(res3.status).toBe(429)

    const res4 = await app.fetch(req2, env, ctx) // 1 for 4.4.4.4 - should succeed
    expect(res4.status).toBe(200)
  })

  it('should return 500 when KV storage fails', async () => {
    const req = new Request('http://localhost/test', {
      headers: { 'cf-connecting-ip': '5.5.5.5' }
    })
    const failingMockKV = {
      ...mockKV,
      get: vi.fn(async () => {
        throw new Error('KV is down')
      })
    }
    const env = { FATHOM_KV: failingMockKV as KVNamespace }
    const ctx = { waitUntil: vi.fn() } as any

    const res = await app.fetch(req, env, ctx)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data).toEqual({ error: 'internal_error', message: 'Rate limit storage unavailable' })
  })
})
