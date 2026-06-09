import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { rateLimitMiddleware } from '../../src/middleware/rate_limit'
import { metricsMiddleware, InMemoryMetricsStorage } from '../../src/middleware/metrics'
import type { FathomEnv } from '../../src/cache'

describe('Rate Limit Middleware - Success and Payload Metrics Integration', () => {
  let app: Hono<{ Bindings: FathomEnv }>
  let mockKV: any
  let metricsStorage: InMemoryMetricsStorage

  beforeEach(() => {
    mockKV = {
      store: new Map<string, string>(),
      get: vi.fn(async (key: string) => mockKV.store.get(key) || null),
      put: vi.fn(async (key: string, value: string) => {
        mockKV.store.set(key, value)
      })
    }
    metricsStorage = new InMemoryMetricsStorage()

    app = new Hono<{ Bindings: FathomEnv }>()
    // Combine metrics and rate limit middleware
    app.use('*', metricsMiddleware(metricsStorage))
    app.use('/test-endpoint', rateLimitMiddleware(60, 60000))

    app.get('/test-endpoint', (c) => {
      return c.json({
        ok: true,
        payloadMetrics: {
          itemsProcessed: 42,
          efficiency: 0.98
        }
      }, 200)
    })
  })

  it('should explicitly verify 200 OK successful response and payload metrics logic', async () => {
    const req = new Request('http://localhost/test-endpoint', {
      headers: { 'cf-connecting-ip': '192.168.0.1' }
    })
    const env = { FATHOM_KV: mockKV as KVNamespace }
    const ctx = { waitUntil: vi.fn((p) => p.catch(() => {})) } as any

    const res = await app.fetch(req, env, ctx)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data).toEqual({
      ok: true,
      payloadMetrics: {
        itemsProcessed: 42,
        efficiency: 0.98
      }
    })

    // Verify metrics storage recorded the 200 OK
    expect(metricsStorage.requestCounts['GET /test-endpoint 200']).toBe(1)
  })

  it('should reject with 429 when rate limit is exceeded, simulating limit being reached', async () => {
    // Simulate rate limit reached by mocking FATHOM_KV.get to return a string value equal to or greater than the limit
    mockKV.get.mockResolvedValueOnce('60')

    const req = new Request('http://localhost/test-endpoint', {
      headers: { 'cf-connecting-ip': '192.168.0.2' }
    })
    const env = { FATHOM_KV: mockKV as KVNamespace }
    const ctx = { waitUntil: vi.fn((p) => p.catch(() => {})) } as any

    const res = await app.fetch(req, env, ctx)
    expect(res.status).toBe(429)

    const data = await res.json()
    expect(data).toEqual({ error: 'rate_limited', message: 'Too many requests' })

    // Verify metrics storage recorded the 429 Error
    expect(metricsStorage.requestCounts['GET /test-endpoint 429']).toBe(1)
  })
})
