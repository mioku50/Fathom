import { describe, it, expect, vi } from 'vitest'
import app from '../src/index'
import type { PriceResponse } from '../src/schema'
import type { FathomEnv } from '../src/cache'

vi.mock('../src/api/metadata', () => ({
  getTokenMetadata: vi.fn().mockResolvedValue({
    address: '0x1234567890123456789012345678901234567890',
    symbol: 'TST',
    name: 'Test Token',
    decimals: 18
  })
}))

describe('Fathom API', () => {
  it('Should return ok for /v1/health', async () => {
    const req = new Request('http://localhost/v1/health')
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.service).toBe('fathom-api')
    expect(body.timestamp).toBeDefined()
    expect(typeof body.timestamp).toBe('string')
  })

  it('Should rate limit /v1/health if FATHOM_KV is bound', async () => {
    // The middleware defaults are limit=60, windowMs=60000.
    // For test purposes, let's say the KV returns string values.
    const mockPut = vi.fn().mockResolvedValue(undefined)

    // We simulate KV returning the count
    let callCount = 0
    const mockGet = vi.fn().mockImplementation(() => {
      if (callCount === 0) return Promise.resolve(null)
      return Promise.resolve(callCount.toString())
    })

    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace
    const env: FathomEnv = { FATHOM_KV: mockKV }

    // Send 60 requests that should pass (0 to 59 in our mock counter)
    // Actually our mockGet needs to track the real request flow or we can just send enough requests
    for (let i = 0; i < 60; i++) {
      const req = new Request('http://localhost/v1/health', {
        headers: { 'cf-connecting-ip': '192.168.1.1' }
      })
      const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
      expect(res.status).toBe(200)
      callCount++
    }

    // The 61st request should be rate limited
    const reqLimit = new Request('http://localhost/v1/health', {
      headers: { 'cf-connecting-ip': '192.168.1.1' }
    })
    const resLimit = await app.fetch(reqLimit, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(resLimit.status).toBe(429)
    const bodyLimit = await resLimit.json() as any
    expect(bodyLimit.error).toBe('rate_limited')
  })

  it('Should bypass rate limit for /v1/health if FATHOM_KV is NOT bound', async () => {
    const env: FathomEnv = { FATHOM_KV: undefined }

    for (let i = 0; i < 65; i++) {
      const req = new Request('http://localhost/v1/health')
      const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
      expect(res.status).toBe(200)
    }
  })

  it('Should return 500 for /v1/health if KV operation fails', async () => {
    const mockGet = vi.fn().mockRejectedValue(new Error('KV failure'))
    const mockKV = { get: mockGet, put: vi.fn(), delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace
    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/health', {
      headers: { 'cf-connecting-ip': '192.168.1.2' }
    })

    // Mock console.error to avoid polluting test output
    const originalConsoleError = console.error
    console.error = vi.fn()

    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)

    const body = await res.json() as any
    expect(body.error).toBe('internal_error')
    expect(body.message).toBe('Rate limit storage unavailable')

    // Restore console.error
    console.error = originalConsoleError
  })

  it('Should return ok for /v1/cache/stats and not require payment', async () => {
    const req = new Request('http://localhost/v1/cache/stats')
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.hits).toBeDefined()
    expect(body.misses).toBeDefined()
    expect(typeof body.hits).toBe('number')
    expect(typeof body.misses).toBe('number')
  })

  it('Should return 400 for /v1/price if token address is invalid', async () => {
    const req = new Request('http://localhost/v1/price?token=invalid_token&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)

    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toBe('Invalid token address format')
  })

  it('Should return 402 payment required if no X-PAYMENT header is present', async () => {
    const req = new Request('http://localhost/v1/price?token=0x0000000000000000000000000000000000000000&chain=base')
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(402)

    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe('payment_required')
  })

  it('Should return valid schema for /v1/price (no cache)', async () => {
    const req = new Request('http://localhost/v1/price?token=0x0000000000000000000000000000000000000000&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as PriceResponse
    expect(body.token).toBe('0x0000000000000000000000000000000000000000')
    expect(body.chain).toBe('base')
    expect(body.symbol).toBeDefined()
    expect(body.price_usd).toBeDefined()
    expect(body.price_low).toBeDefined()
    expect(body.price_high).toBeDefined()
    expect(body.twap_5m).toBeDefined()
    expect(body.confidence).toBeDefined()
    expect(body.label).toBeDefined()
    expect(body.liquidity_usd).toBeDefined()
    expect(body.main_pool).toBeDefined()
    expect(body.flags).toBeDefined()
    expect(body.updated_at).toBeDefined()
  })

  it('Should bypass payment block if Authorization header is present', async () => {
    const req = new Request('http://localhost/v1/price?token=0x0000000000000000000000000000000000000000&chain=base', {
      headers: { 'Authorization': 'Bearer mock_token' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)
  })

  it('Should return 400 for /v1/prices if tokens parameter is missing', async () => {
    const req = new Request('http://localhost/v1/prices?chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('tokens parameter is required')
  })

  it('Should return 400 for /v1/prices if more than 10 tokens are requested', async () => {
    const tokens = '0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222,0x3333333333333333333333333333333333333333,0x4444444444444444444444444444444444444444,0x5555555555555555555555555555555555555555,0x6666666666666666666666666666666666666666,0x7777777777777777777777777777777777777777,0x8888888888888888888888888888888888888888,0x9999999999999999999999999999999999999999,0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const req = new Request(`http://localhost/v1/prices?tokens=${tokens}&chain=base`, {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('Maximum 10 tokens allowed per request')
  })

  it('Should return 400 for /v1/prices if a token address is invalid', async () => {
    const req = new Request('http://localhost/v1/prices?tokens=0x0000000000000000000000000000000000000000,invalid_token&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)

    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toBe('Invalid token address format: invalid_token')
  })

  it('Should return valid schema for /v1/prices (batch)', async () => {
    const req = new Request('http://localhost/v1/prices?tokens=0x0000000000000000000000000000000000000000,0x1111111111111111111111111111111111111111&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as PriceResponse[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(2)

    expect(body[0].token).toBe('0x0000000000000000000000000000000000000000')
    expect(body[1].token).toBe('0x1111111111111111111111111111111111111111')

    expect(body[0].symbol).toBe('DUMMY')
    expect(body[1].symbol).toBe('DUMMY')
  })

  it('Should bypass payment block for /v1/prices if Authorization header is present', async () => {
    const req = new Request('http://localhost/v1/prices?tokens=0x0000000000000000000000000000000000000000&chain=base', {
      headers: { 'Authorization': 'Bearer mock_token' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)
  })

  it('Should set cache on first request if FATHOM_KV is bound', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/price?token=0x1111111111111111111111111111111111111111&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    expect(mockGet).toHaveBeenCalledWith('price:base:0x1111111111111111111111111111111111111111', 'json')
    expect(mockPut).toHaveBeenCalledWith(
      'price:base:0x1111111111111111111111111111111111111111',
      expect.any(String),
      { expirationTtl: 60 }
    )
  })

  it('Should use CACHE_DEFAULT_TTL_SECONDS from env if provided and valid', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = {
      FATHOM_KV: mockKV,
      CACHE_DEFAULT_TTL_SECONDS: '120'
    }

    const req = new Request('http://localhost/v1/price?token=0x1111111111111111111111111111111111111111&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    expect(mockGet).toHaveBeenCalledWith('price:base:0x1111111111111111111111111111111111111111', 'json')
    expect(mockPut).toHaveBeenCalledWith(
      'price:base:0x1111111111111111111111111111111111111111',
      expect.any(String),
      { expirationTtl: 120 }
    )
  })

  it('Should fall back to 60s if CACHE_DEFAULT_TTL_SECONDS is invalid', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = {
      FATHOM_KV: mockKV,
      CACHE_DEFAULT_TTL_SECONDS: 'invalid'
    }

    const req = new Request('http://localhost/v1/price?token=0x1111111111111111111111111111111111111111&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    expect(mockPut).toHaveBeenCalledWith(
      'price:base:0x1111111111111111111111111111111111111111',
      expect.any(String),
      { expirationTtl: 60 }
    )
  })

  it('Should fall back to 60s if CACHE_DEFAULT_TTL_SECONDS is less than 60', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = {
      FATHOM_KV: mockKV,
      CACHE_DEFAULT_TTL_SECONDS: '30'
    }

    const req = new Request('http://localhost/v1/price?token=0x1111111111111111111111111111111111111111&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    expect(mockPut).toHaveBeenCalledWith(
      'price:base:0x1111111111111111111111111111111111111111',
      expect.any(String),
      { expirationTtl: 60 }
    )
  })

  it('Should return cached response if FATHOM_KV has it', async () => {
    const cachedResponse: PriceResponse = {
      token: '0x1111111111111111111111111111111111111111',
      chain: 'base',
      symbol: 'CACHED',
      price_usd: 2.0,
      price_low: 1.9,
      price_high: 2.1,
      twap_5m: 2.0,
      confidence: 90,
      label: 'reliable',
      liquidity_usd: 200000,
      main_pool: { dex: 'aerodrome', address: '0x456', fee: 0.003 },
      flags: [],
      updated_at: new Date().toISOString()
    }

    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(cachedResponse)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/price?token=0x1111111111111111111111111111111111111111&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as PriceResponse
    expect(body.symbol).toBe('CACHED')

    expect(mockGet).toHaveBeenCalledWith('price:base:0x1111111111111111111111111111111111111111', 'json')
    // Put shouldn't be called if cache hit
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('Should return 402 for /v1/cache/invalidate without payment', async () => {
    const req = new Request('http://localhost/v1/cache/invalidate?token=0x0000000000000000000000000000000000000000', {
      method: 'POST'
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(402)
  })

  it('Should return 400 for /v1/cache/invalidate if token is missing', async () => {
    const req = new Request('http://localhost/v1/cache/invalidate', {
      method: 'POST',
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('token parameter is required')
  })

  it('Should call KV delete and return ok for /v1/cache/invalidate', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined)
    const mockKV = { get: vi.fn(), put: vi.fn(), delete: mockDelete, list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/cache/invalidate?token=0x0000000000000000000000000000000000000000&chain=base', {
      method: 'POST',
      headers: { 'X-PAYMENT': 'mock_payment' }
    })

    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.message).toBe('Cache invalidated successfully')

    expect(mockDelete).toHaveBeenCalledWith('price:base:0x0000000000000000000000000000000000000000')
  })

  it('Should successfully return metadata for /v1/metadata', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const env = {
      FATHOM_KV: {
        get: mockGet,
        put: mockPut
      }
    } as unknown as FathomEnv

    const req = new Request('http://localhost/v1/metadata?token=0x1234567890123456789012345678901234567890&chain=base', {
      method: 'GET',
      headers: { 'X-PAYMENT': 'mock_payment' }
    })

    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body).toEqual({
      address: '0x1234567890123456789012345678901234567890',
      symbol: 'TST',
      name: 'Test Token',
      decimals: 18
    })

    // verify it was cached
    expect(mockPut).toHaveBeenCalled()
    expect(mockPut.mock.calls[0][0]).toBe('metadata-base-0x1234567890123456789012345678901234567890')
  })

  it('Should return 500 if KV delete fails for /v1/cache/invalidate', async () => {
    const mockDelete = vi.fn().mockRejectedValue(new Error('KV error'))
    const mockKV = { get: vi.fn(), put: vi.fn(), delete: mockDelete, list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/cache/invalidate?token=0x0000000000000000000000000000000000000000&chain=base', {
      method: 'POST',
      headers: { 'X-PAYMENT': 'mock_payment' }
    })

    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)

    const body = await res.json() as any
    expect(body.error).toBe('Failed to invalidate cache')
  })
})
