import { describe, it, expect, vi } from 'vitest'
import app from '../src/index'

const VALID_ENV = {
  FATHOM_X402_FACILITATOR_URL: 'https://api.fathom.network/facilitator',
  X402_NETWORK: 'base-sepolia',
  X402_PRICE_USDC: '0.01',
  BASE_RPC_URL: 'http://localhost:8545',
  FATHOM_X402_RECIPIENT: '0x123',
  CACHE_DEFAULT_TTL_SECONDS: '60',
  ADMIN_AUTH_TOKEN: 'mock-token',
  PRICE_RPC_URL: 'http://localhost:8545',
  PRICE_CHAIN_ID: '8453'
};
import { isPriceResponse, type PriceResponse } from '../src/schema'
import type { FathomEnv } from '../src/cache'

vi.mock('../src/orchestrator', () => {
  return {
    DEXOrchestrator: vi.fn().mockImplementation(() => {
      return {
        getAllPools: vi.fn().mockResolvedValue([{ address: '0xabc', dex: 'aerodrome', fee: 0.003 }]),
        getAllRawData: vi.fn().mockResolvedValue([{
          pool: { address: '0xabc', dex: 'aerodrome', fee: 0.003 },
          rawData: {
            reserve0: 1000000000000000000n,
            reserve1: 1500000000000000000n, // price 1.5
            updatedAt: 12345
          }
        }])
      };
    })
  };

  it('Should handle KV get error gracefully for /v1/metadata by proceeding to fetch', async () => {
    const mockGet = vi.fn().mockRejectedValue(new Error('KV read error'))
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const env = {
      FATHOM_KV: {
        get: mockGet,
        put: mockPut
      }
    } as unknown as FathomEnv

    const req = new Request('http://localhost/v1/metadata?token=0x1234567890123456789012345678901234567890&chain=base', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.address).toBe('0x1234567890123456789012345678901234567890')
    expect(mockGet).toHaveBeenCalled()
    expect(mockPut).toHaveBeenCalled()
  })

  it('Should handle KV get error gracefully for /v1/metadatas by proceeding to fetch', async () => {
    const mockGet = vi.fn().mockRejectedValue(new Error('KV read error'))
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const env = {
      FATHOM_KV: {
        get: mockGet,
        put: mockPut
      }
    } as unknown as FathomEnv

    const req = new Request('http://localhost/v1/metadatas?tokens=0x1234567890123456789012345678901234567890&chain=base', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.length).toBe(1)
    expect(body[0].address).toBe('0x1234567890123456789012345678901234567890')
    expect(mockGet).toHaveBeenCalled()
    expect(mockPut).toHaveBeenCalled()
  })

});



vi.mock('../src/api/metadata', () => ({
  getTokenMetadata: vi.fn().mockResolvedValue({
    address: '0x1234567890123456789012345678901234567890',
    symbol: 'TST',
    name: 'Test Token',
    decimals: 18
  }),
  getBatchTokenMetadata: vi.fn().mockImplementation(async (tokens) => {
    return tokens.map((t: string) => ({
      address: t,
      symbol: 'TST',
      name: 'Test Token',
      decimals: 18
    }))
  })
}))

describe('Fathom API', () => {
  global.fetch = vi.fn().mockImplementation((url: any) => {
    if (url.toString().includes('supported')) {
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', asset: 'usdc' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
  it('Should return ok for /v1/health', async () => {
    const req = new Request('http://localhost/v1/health')
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
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
      const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
      expect(res.status).toBe(200)
      callCount++
    }

    // The 61st request should be rate limited
    const reqLimit = new Request('http://localhost/v1/health', {
      headers: { 'cf-connecting-ip': '192.168.1.1' }
    })
    const resLimit = await app.fetch(reqLimit, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(resLimit.status).toBe(429)
    const bodyLimit = await resLimit.json() as any
    expect(bodyLimit.error).toBe('rate_limited')
  })

  it('Should bypass rate limit for /v1/health if FATHOM_KV is NOT bound', async () => {
    const env: FathomEnv = { FATHOM_KV: undefined }

    for (let i = 0; i < 65; i++) {
      const req = new Request('http://localhost/v1/health')
      const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
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

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)

    const body = await res.json() as any
    expect(body.error).toBe('internal_error')
    expect(body.message).toBe('Rate limit storage unavailable')

    // Restore console.error
    console.error = originalConsoleError
  })

  it('Should return ok for /v1/cache/stats and not require payment', async () => {
    const req = new Request('http://localhost/v1/cache/stats')
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.hits).toBeDefined()
    expect(body.misses).toBeDefined()
    expect(typeof body.hits).toBe('number')
    expect(typeof body.misses).toBe('number')
  })

  it('Should return 400 for /v1/price if token address is invalid', async () => {
    const req = new Request('http://localhost/v1/price?token=invalid_token&chain=base', {
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)

    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toBe('Invalid token address format')

    expect(consoleSpy).toHaveBeenCalledWith('[Validation Middleware] Invalid token address format: invalid_token')
    consoleSpy.mockRestore()
  })

  it('Should return 402 payment required if no X-PAYMENT header is present', async () => {
    const req = new Request('http://localhost/v1/price?token=0x0000000000000000000000000000000000000000&chain=base')
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(402)

    expect(res.headers.get('Payment-Required')).toBeDefined()
  })

  it('Should return valid schema for /v1/price (no cache)', async () => {
    const req = new Request('http://localhost/v1/price?token=0x0000000000000000000000000000000000000000&chain=base', {
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
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
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)
  })

  it('Should return 400 for /v1/prices if tokens parameter is missing', async () => {
    const req = new Request('http://localhost/v1/prices?chain=base', {
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toBe('tokens parameter is required')
  })

  it('Should return 400 for /v1/prices if more than 50 tokens are requested', async () => {
    const tokens = Array(51).fill('0x940181a94A35A4569E4529A3CDfB74e38FD98631').join(',')
    const req = new Request(`http://localhost/v1/prices?tokens=${tokens}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toMatch(/Maximum 50 tokens allowed per request/)
  })

  it('Should return 400 for /v1/prices if a token address is invalid', async () => {
    const req = new Request('http://localhost/v1/prices?tokens=0x0000000000000000000000000000000000000000,invalid_token&chain=base', {
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)

    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toBe('Invalid token address format: invalid_token')

    expect(consoleSpy).toHaveBeenCalledWith('[Validation Middleware] Invalid token address format in batch: invalid_token')
    consoleSpy.mockRestore()
  })

  it('Should return valid schema for /v1/prices (batch)', async () => {
    const req = new Request(`http://localhost/v1/prices?tokens=0x940181a94A35A4569E4529A3CDfB74e38FD98631,0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, {
      headers: { 'Authorization': `Bearer ${VALID_ENV.ADMIN_AUTH_TOKEN}` }
    })
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p } as any)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(typeof body).toBe('object')
    expect(body.chain).toBe('base')
    expect(body.count).toBe(2)
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results.length).toBe(2)

    for (const item of body.results) {
      if (item.status === 'ok') {
        expect(isPriceResponse(item)).toBe(true)
      } else {
        expect(item.status).toBe('not_found')
      }
    }
  })

  it('Should bypass payment block for /v1/prices if Authorization header is present', async () => {
    const req = new Request('http://localhost/v1/prices?tokens=0x0000000000000000000000000000000000000000&chain=base', {
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)
  })

  it('Should set cache on first request if FATHOM_KV is bound', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/price?token=0x1111111111111111111111111111111111111111&chain=base', {
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
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
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
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
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
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
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
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
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as PriceResponse
    expect(body.symbol).toBe('CACHED')

    expect(mockGet).toHaveBeenCalledWith('price:base:0x1111111111111111111111111111111111111111', 'json')
    // Put shouldn't be called if cache hit
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('Should return 401 for /v1/cache/invalidate without admin auth', async () => {
    const req = new Request('http://localhost/v1/cache/invalidate?token=0xabc', {
      method: 'POST',
    })
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(401)
  })

  it('Should return 400 for /v1/cache/invalidate if token is missing', async () => {
    const req = new Request('http://localhost/v1/cache/invalidate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toBe('Either token or pool parameter is required')
  })

  it('Should call KV delete and return ok for /v1/cache/invalidate', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined)
    const mockKV = { get: vi.fn(), put: vi.fn(), delete: mockDelete, list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/cache/invalidate?token=0x0000000000000000000000000000000000000000&chain=base', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.message).toBe('Cache invalidated successfully')

    expect(mockDelete).toHaveBeenCalledWith('price:base:0x0000000000000000000000000000000000000000')
  })

  it('Should successfully return metadata for /v1/metadata and pass env config', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const env = {
      FATHOM_KV: {
        get: mockGet,
        put: mockPut
      },
      BASE_RPC_URL: 'http://custom-rpc.test',
      X402_NETWORK: 'base-sepolia'
    } as unknown as FathomEnv

    const req = new Request('http://localhost/v1/metadata?token=0x1234567890123456789012345678901234567890&chain=base', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body).toEqual({
      address: '0x1234567890123456789012345678901234567890',
      symbol: 'TST',
      name: 'Test Token',
      decimals: 18
    })

    // verify env args were passed to getTokenMetadata
    const { getTokenMetadata } = await import('../src/api/metadata')
    expect(getTokenMetadata).toHaveBeenCalledWith(
      '0x1234567890123456789012345678901234567890',
      'http://custom-rpc.test',
      'base-sepolia'
    )

    // verify it was cached
    expect(mockPut).toHaveBeenCalled()
    expect(mockPut.mock.calls[0][0]).toBe('metadata-base-0x1234567890123456789012345678901234567890')
  })


  it('Should use cached metadata for subsequent requests to /v1/metadata', async () => {
    const cachedMetadata = {
      address: '0x1234567890123456789012345678901234567890',
      symbol: 'CACHED',
      name: 'Cached Token',
      decimals: 6
    }

    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(JSON.stringify(cachedMetadata))
    const env = {
      FATHOM_KV: {
        get: mockGet,
        put: mockPut
      }
    } as unknown as FathomEnv

    const req = new Request('http://localhost/v1/metadata?token=0x1234567890123456789012345678901234567890&chain=base', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body).toEqual(cachedMetadata)

    // verify it was read from cache and NOT written to
    expect(mockGet).toHaveBeenCalledWith('metadata-base-0x1234567890123456789012345678901234567890')
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('Should return 500 if KV delete fails for /v1/cache/invalidate', async () => {
    const mockDelete = vi.fn().mockRejectedValue(new Error('KV error'))
    const mockKV = { get: vi.fn(), put: vi.fn(), delete: mockDelete, list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/cache/invalidate?token=0x0000000000000000000000000000000000000000&chain=base', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)

    const body = await res.json() as any
    expect(body.error).toBe('internal_error')
    expect(body.message).toBe('Failed to invalidate cache')
  })


  it('Should return metadata for multiple tokens successfully for /v1/metadatas and pass env config', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const env = {
      FATHOM_KV: {
        get: mockGet,
        put: mockPut
      },
      BASE_RPC_URL: 'http://custom-rpc.test',
      X402_NETWORK: 'base-sepolia'
    } as unknown as FathomEnv

    const req = new Request('http://localhost/v1/metadatas?tokens=0x1234567890123456789012345678901234567890,0x0987654321098765432109876543210987654321&chain=base', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.length).toBe(2)
    expect(body[0].address).toBe('0x1234567890123456789012345678901234567890')
    expect(body[1].address).toBe('0x0987654321098765432109876543210987654321')

    // verify env args were passed to getBatchTokenMetadata
    const { getBatchTokenMetadata } = await import('../src/api/metadata')
    expect(getBatchTokenMetadata).toHaveBeenCalledWith(
      ['0x1234567890123456789012345678901234567890', '0x0987654321098765432109876543210987654321'],
      'http://custom-rpc.test',
      'base-sepolia'
    )

    // verify both were cached
    expect(mockPut).toHaveBeenCalledTimes(2)
    expect(mockPut.mock.calls[0][0]).toBe('metadata-base-0x1234567890123456789012345678901234567890')
    expect(mockPut.mock.calls[1][0]).toBe('metadata-base-0x0987654321098765432109876543210987654321')
  })

  it('Should use cached metadata and fetch missing metadata for /v1/metadatas', async () => {
    const cachedMetadata = {
      address: '0x1234567890123456789012345678901234567890',
      symbol: 'CACHED',
      name: 'Cached Token',
      decimals: 6
    }

    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockImplementation(async (key) => {
      if (key === 'metadata-base-0x1234567890123456789012345678901234567890') {
        return JSON.stringify(cachedMetadata)
      }
      return null
    })

    const env = {
      FATHOM_KV: {
        get: mockGet,
        put: mockPut
      }
    } as unknown as FathomEnv

    const req = new Request('http://localhost/v1/metadatas?tokens=0x1234567890123456789012345678901234567890,0x0987654321098765432109876543210987654321&chain=base', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.length).toBe(2)

    // First should be cached
    expect(body[0]).toEqual(cachedMetadata)

    // Second should be fetched
    expect(body[1].address).toBe('0x0987654321098765432109876543210987654321')

    // verify it was read from cache
    expect(mockGet).toHaveBeenCalledTimes(2)
    // verify ONLY the second was written to cache
    expect(mockPut).toHaveBeenCalledTimes(1)
    expect(mockPut.mock.calls[0][0]).toBe('metadata-base-0x0987654321098765432109876543210987654321')
  })

  it('Should return 400 for /v1/metadatas if tokens are missing', async () => {
    const req = new Request('http://localhost/v1/metadatas', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toBe('tokens parameter is required')
  })

  it('Should return 400 for /v1/metadatas if tokens exceed 10', async () => {
    const tokens = Array(11).fill('0x1234567890123456789012345678901234567890').join(',')
    const req = new Request(`http://localhost/v1/metadatas?tokens=${tokens}`, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    const res = await app.fetch(req, VALID_ENV, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toBe('Maximum 10 tokens allowed per request')
  })

  it('Should successfully return 200 for /v1/health', async () => {
    const mockKV = { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined), delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace
    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/health', {
      method: 'GET'
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.service).toBe('fathom-api')
    expect(body).toHaveProperty('timestamp')
  })

  it('Should return 429 Too Many Requests for /v1/health when rate limit is exceeded', async () => {
    const mockGet = vi.fn().mockResolvedValue('60') // Simulate limit reached
    const mockKV = { get: mockGet, put: vi.fn().mockResolvedValue(undefined), delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace
    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/health', {
      method: 'GET'
    })

    // To properly simulate the IP being known, we need to add a CF-Connecting-IP header
    const reqWithIp = new Request('http://localhost/v1/health', {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '1.2.3.4' }
    })

    const res = await app.fetch(reqWithIp, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(429)

    const body = await res.json() as any
    expect(body.error).toBe('rate_limited')
  })

})
