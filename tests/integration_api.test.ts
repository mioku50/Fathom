import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index'

const VALID_ENV = {
  FATHOM_X402_FACILITATOR_URL: 'http://mock-facilitator',
  X402_NETWORK: 'base-sepolia',
  X402_PRICE_USDC: '0.01',
  BASE_RPC_URL: 'http://localhost:8545',
  FATHOM_X402_RECIPIENT: '0x123',
  CACHE_DEFAULT_TTL_SECONDS: '60',
  ADMIN_AUTH_TOKEN: 'mock-token',
  PRICE_RPC_URL: 'http://localhost:8545',
  PRICE_CHAIN_ID: '8453'
};
import { PriceRpcClient } from '../src/utils/price_rpc'
import type { PriceResponse } from '../src/schema'
import type { FathomEnv } from '../src/cache'
import { resetCacheStats } from '../src/cache'

vi.mock('../src/orchestrator', () => {
  return {
    DEXOrchestrator: vi.fn().mockImplementation(() => {
      let lastToken = '';
      return {
        getAllPools: vi.fn().mockImplementation(async (token: string) => {
          lastToken = token.toLowerCase();
          return [{ address: '0xabc', dex: 'aerodrome', fee: 0.003 }];
        }),
        getAllRawData: vi.fn().mockImplementation(async (pools: any[]) => [{
          pool: pools[0] || { address: '0xabc', dex: 'aerodrome', fee: 0.003 },
          rawData: {
            reserve0: 1000000000000000000n,
            reserve1: 1500000000000000000n, // price 1.5
            updatedAt: 12345,
            token0: lastToken || '0x0000000000000000000000000000000000000000',
            token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' // USDC
          }
        }])
      };
    })
  };
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


// Deterministic decimals for these route-level tests. Previously they passed only
// because getTokenDecimals() silently fell back to 18 when the RPC was unreachable;
// that fallback is gone, so the stub now states the assumption explicitly.
vi.spyOn(PriceRpcClient.prototype, 'getTokenDecimals').mockImplementation(
  async (tokenAddress: string) =>
    tokenAddress.toLowerCase() === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' ? 6 : 18
)

describe('Fathom API Integration Test', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url: any) => {
      const urlStr = url?.toString() || ''
      if (urlStr.includes('supported') || urlStr.includes('kinds')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', asset: 'usdc' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    });
  });

  it('Should process a valid request, set cache, and return valid structure through /v1/price', async () => {
    // 1. Setup mock KV for cache layer integration
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    // 2. Make an end-to-end request handling validation and x402 payment
    const token = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/price?token=${token}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    // 3. Inject waitUntil and app execution
    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)

    // 4. Assert HTTP success
    expect(res.status).toBe(200)

    // 5. Assert Response Schema
    const body = await res.json() as PriceResponse
    expect(body.token).toBe(token)
    expect(body.chain).toBe('base')
    expect(body.price_usd).toBeDefined()
    expect(body.confidence).toBeDefined()
    expect(body.flags).toBeDefined()

    // 6. Assert caching layer is exercised
    expect(mockGet).toHaveBeenCalledWith(`price:base:${token}`, 'json')
    expect(mockPut).toHaveBeenCalledWith(
      `price:base:${token}`,
      expect.any(String), // Ensure body is converted to JSON string and passed to kv
      expect.objectContaining({ expirationTtl: 60 })
    )
  })

  it('Should fail end-to-end request if validation fails', async () => {
    const env: FathomEnv = {}

    // Invalid token length
    const token = '0x123'
    const req = new Request(`http://localhost/v1/price?token=${token}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)

    expect(consoleSpy).toHaveBeenCalledWith(`[Validation Middleware] Invalid token address format: ${token}`)
    consoleSpy.mockRestore()
  })

  it('Should fail /v1/prices if validation fails with invalid token format', async () => {
    const env: FathomEnv = {}

    // Multiple tokens where one is invalid
    const tokens = '0x1234567890123456789012345678901234567890,invalid-token'
    const req = new Request(`http://localhost/v1/prices?tokens=${tokens}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)

    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toContain('invalid-token')

    expect(consoleSpy).toHaveBeenCalledWith(`[Validation Middleware] Invalid token address format in batch: invalid-token`)
    consoleSpy.mockRestore()
  })

  it('Should ignore blank tokens caused by extra commas in /v1/prices validation', async () => {
    const env: FathomEnv = {}

    // Valid tokens with trailing/extra commas
    const tokens = '0x1234567890123456789012345678901234567890,,0x0987654321098765432109876543210987654321,'
    const req = new Request(`http://localhost/v1/prices?tokens=${tokens}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    // Mock KV for cache layer needed for a successful path
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace
    env.FATHOM_KV = mockKV

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    // 402 or 200 depending on middleware order, but if it passes validation it won't be 400.
    // It will actually process successfully because we provided X-PAYMENT.
    expect(res.status).toBe(200)

    const body = await res.json() as any
    // It should have processed 2 tokens
    expect(body.count).toBe(2)
  })

  it('Should fail end-to-end request if x402 payment is missing', async () => {
    const env: FathomEnv = {}

    // Valid token but missing X-PAYMENT header
    const token = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/price?token=${token}&chain=base`)

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(402)
    const body = await res.text()
    expect(res.headers.get('Payment-Required')).toBeDefined()
  })

  it('Should fail /v1/prices if x402 payment is missing', async () => {
    const env: FathomEnv = {}

    const tokens = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/prices?tokens=${tokens}&chain=base`)

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(402)
    const body = await res.text()
    expect(res.headers.get('Payment-Required')).toBeDefined()
  })

  it('Should fail /v1/metadata if x402 payment is missing', async () => {
    const env: FathomEnv = {}

    const token = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/metadata?token=${token}&chain=base`)

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(402)
    const body = await res.text()
    expect(res.headers.get('Payment-Required')).toBeDefined()
  })


  it('Should successfully process request, set cache and return valid structure through /v1/metadata', async () => {
    // Mock KV for cache layer
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const token = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/metadata?token=${token}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.address).toBe('0x1234567890123456789012345678901234567890')
    expect(body.symbol).toBeDefined()
    expect(body.name).toBeDefined()
    expect(body.decimals).toBeDefined()

    // KV assertions for cache miss
    expect(mockGet).toHaveBeenCalledWith(`metadata-base-${token}`)
    expect(mockPut).toHaveBeenCalledWith(
      `metadata-base-${token}`,
      expect.any(String),
      expect.objectContaining({ expirationTtl: 86400 })
    )
  })

  it('Should return cached response on /v1/metadata if available', async () => {
    const cachedMetadata = {
      address: '0x1234567890123456789012345678901234567890',
      symbol: 'CACHE',
      name: 'Cached Token',
      decimals: 18
    }

    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(JSON.stringify(cachedMetadata))
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const token = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/metadata?token=${token}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    // Should return cached data
    expect(body.symbol).toBe('CACHE')

    // KV assertions for cache hit
    expect(mockGet).toHaveBeenCalledWith(`metadata-base-${token}`)
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('Should successfully process batch request through /v1/metadatas', async () => {
    // Mock KV for cache layer
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const tokens = '0x1234567890123456789012345678901234567890,0x0987654321098765432109876543210987654321'
    const req = new Request(`http://localhost/v1/metadatas?tokens=${tokens}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(2)

    // First token
    expect(body[0].address).toBe('0x1234567890123456789012345678901234567890')
    expect(body[0].symbol).toBeDefined()
    expect(body[0].name).toBeDefined()

    // Second token
    expect(body[1].address).toBe('0x0987654321098765432109876543210987654321')
    expect(body[1].symbol).toBeDefined()
    expect(body[1].name).toBeDefined()

    // KV assertions
    expect(mockGet).toHaveBeenCalledWith(`metadata-base-0x1234567890123456789012345678901234567890`)
    expect(mockGet).toHaveBeenCalledWith(`metadata-base-0x0987654321098765432109876543210987654321`)
  })

  it('Should fail /v1/metadatas if tokens limit exceeded', async () => {
    const env: FathomEnv = {}
    const tokens = Array(11).fill('0x1234567890123456789012345678901234567890').join(',')
    const req = new Request(`http://localhost/v1/metadatas?tokens=${tokens}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)

    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(body.error).toBe('invalid_request')
    expect(body.message).toContain('Maximum 10 tokens allowed')
  })

  it('Should fail /v1/metadatas if x402 payment missing', async () => {
    const env: FathomEnv = {}
    const tokens = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/metadatas?tokens=${tokens}&chain=base`)

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(402)
  })

  it('Should return health status and basic metrics from /v1/health', async () => {
    const env: FathomEnv = {}
    const req = new Request('http://localhost/v1/health')

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.service).toBe('fathom-api')
    expect(body.timestamp).toBeDefined()

    // Rigorously verify that the timestamp is a valid ISO date string
    const parsedDate = new Date(body.timestamp)
    expect(isNaN(parsedDate.getTime())).toBe(false)
    expect(parsedDate.toISOString()).toBe(body.timestamp)
  })


  it('Should correctly apply rate limits on /v1/health', async () => {
    // We want to test rate limiting
    // limit is 60, but since the KV mock controls the count, we can simulate the limit being reached
    const mockPut = vi.fn().mockResolvedValue(undefined)

    // First request returns null (no requests yet), second returns "60" (limit reached)
    let getCallCount = 0
    const mockGet = vi.fn().mockImplementation(() => {
      getCallCount++
      if (getCallCount === 1) return Promise.resolve(null)
      return Promise.resolve("60")
    })

    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace
    const env: FathomEnv = { FATHOM_KV: mockKV }

    // First request - should succeed
    const req1 = new Request('http://localhost/v1/health', {
      headers: { 'cf-connecting-ip': '1.2.3.4' }
    })

    const res1 = await app.fetch(req1, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res1.status).toBe(200)

    // Second request - mockGet will return "60", so count becomes 61 > 60
    const req2 = new Request('http://localhost/v1/health', {
      headers: { 'cf-connecting-ip': '1.2.3.4' }
    })

    const res2 = await app.fetch(req2, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res2.status).toBe(429)

    const body = await res2.json() as any
    expect(body.error).toBe('rate_limited')
    expect(body.message).toBe('Too many requests')

    // Verify KV interaction
    expect(mockGet).toHaveBeenCalledWith('ratelimit:1.2.3.4:/v1/health')
    expect(mockPut).toHaveBeenCalledWith('ratelimit:1.2.3.4:/v1/health', '1', expect.objectContaining({ expirationTtl: 60 }))
  })



  it('Should correctly return and update cache stats on /v1/cache/stats', async () => {
    // Reset stats to ensure a clean state
    resetCacheStats()

    // Mock KV for cache layer
    let kvStore = new Map()
    const mockPut = vi.fn().mockImplementation((key, val) => {
      kvStore.set(key, val)
      return Promise.resolve(undefined)
    })
    // For price cache hit, KVCacheLayer expects JSON string, so let's store it as such
    const mockGet = vi.fn().mockImplementation((key, type) => {
      let val = kvStore.get(key)
      if (!val) return Promise.resolve(null)
      if (type === 'json' && typeof val === 'string') {
          return Promise.resolve(JSON.parse(val))
      }
      return Promise.resolve(val)
    })
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    // 1. Check initial stats (should be hits: 0, misses: 0)
    const reqInitial = new Request('http://localhost/v1/cache/stats')
    const resInitial = await app.fetch(reqInitial, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(resInitial.status).toBe(200)
    let stats = await resInitial.json() as any
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)

    const token = '0x1111111111111111111111111111111111111111'

    // 2. Trigger a cache miss by requesting price for a new token
    const reqMiss = new Request(`http://localhost/v1/price?token=${token}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    await app.fetch(reqMiss, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)

    // 3. Trigger a cache hit
    // KVCacheLayer uses kv.get(key, 'json') which we mock to parse strings.
    // So we need to store a string in our kvStore map.
    const priceResponse = {
      token: token,
      chain: 'base',
      price_usd: '1.0',
      confidence: 1.0,
      flags: []
    }
    kvStore.set(`price:base:${token}`, JSON.stringify(priceResponse))

    const reqHit = new Request(`http://localhost/v1/price?token=${token}&chain=base`, {
      headers: { 'Authorization': 'Bearer mock-token' }
    })
    await app.fetch(reqHit, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)

    // 4. Check stats again
    const reqFinal = new Request('http://localhost/v1/cache/stats')
    const resFinal = await app.fetch(reqFinal, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(resFinal.status).toBe(200)
    stats = await resFinal.json() as any

    expect(stats.hits).toBeGreaterThan(0)
    expect(stats.misses).toBeGreaterThan(0)
  })

  it('Should successfully invalidate cache through /v1/cache/invalidate', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined)
    const mockKV = { get: vi.fn(), put: vi.fn(), delete: mockDelete, list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const token = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/cache/invalidate?token=${token}&chain=base`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.message).toBe('Cache invalidated successfully')

    expect(mockDelete).toHaveBeenCalledWith(`price:base:${token.toLowerCase()}`)
  })

  it('Should successfully invalidate cache for pool address through /v1/cache/invalidate', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined)
    const mockKV = { get: vi.fn(), put: vi.fn(), delete: mockDelete, list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const pool = '0x0987654321098765432109876543210987654321'
    const req = new Request(`http://localhost/v1/cache/invalidate?pool=${pool}&chain=base`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.message).toBe('Cache invalidated successfully')

    expect(mockDelete).toHaveBeenCalledWith(`orchestrator:pools:${pool.toLowerCase()}`)
    expect(mockDelete).toHaveBeenCalledWith(`orchestrator:raw:${pool.toLowerCase()}`)
  })

  it('Should fail /v1/cache/invalidate if missing admin auth', async () => {
    const env: FathomEnv = {}
    const req = new Request('http://localhost/v1/cache/invalidate?token=0xabc', {
      method: 'POST'
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: vi.fn() } as unknown as ExecutionContext)
    expect(res.status).toBe(401)
  })

  it('Should successfully clear pool cache through /v1/cache/clear/pool', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined)
    const mockKV = { get: vi.fn(), put: vi.fn(), delete: mockDelete, list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const pool = '0x0987654321098765432109876543210987654321'
    const req = new Request(`http://localhost/v1/cache/clear/pool?pool=${pool}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.message).toBe('Pool cache cleared successfully')

    expect(mockDelete).toHaveBeenCalledWith(`orchestrator:pools:${pool.toLowerCase()}`)
    expect(mockDelete).toHaveBeenCalledWith(`orchestrator:raw:${pool.toLowerCase()}`)
  })

  it('Should fail /v1/cache/clear/pool if missing pool parameter', async () => {
    const env: FathomEnv = {}
    const req = new Request('http://localhost/v1/cache/clear/pool', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)

    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toBe('pool parameter is required')
  })

  it('Should fail /v1/cache/clear/pool if KV not configured', async () => {
    const env: FathomEnv = {}
    const pool = '0x0987654321098765432109876543210987654321'
    const req = new Request(`http://localhost/v1/cache/clear/pool?pool=${pool}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)

    const body = await res.json() as any
    expect(body.error).toBe('internal_error')
    expect(body.message).toBe('KV not configured')
  })

  it('Should handle errors on /v1/cache/clear/pool gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockDelete = vi.fn().mockRejectedValue(new Error('KV Delete Error'))
    const mockKV = { delete: mockDelete } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const pool = '0x0987654321098765432109876543210987654321'
    const req = new Request(`http://localhost/v1/cache/clear/pool?pool=${pool}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)

    const body = await res.json() as any
    expect(body.error).toBe('internal_error')
    expect(body.message).toBe('Failed to clear pool cache')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('Should fail /v1/cache/clear/pool if missing admin auth', async () => {
    const env: FathomEnv = {}
    const req = new Request('http://localhost/v1/cache/clear/pool?pool=0xabc', {
      method: 'POST'
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: vi.fn() } as unknown as ExecutionContext)
    expect(res.status).toBe(401)
  })

  it('Should fail /v1/cache/invalidate if missing token or pool', async () => {
    const env: FathomEnv = {}
    const req = new Request('http://localhost/v1/cache/invalidate?chain=base', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)

    const body = await res.json() as any
    expect(body.error).toBe('invalid_request')
    expect(body.message).toBe('Either token or pool parameter is required')
  })

  it('Should successfully clear all cache through /v1/cache/clear', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined)
    const mockList = vi.fn()
      .mockResolvedValueOnce({
        keys: [{ name: 'key1' }, { name: 'key2' }],
        list_complete: false,
        cursor: 'cursor1'
      })
      .mockResolvedValueOnce({
        keys: [{ name: 'key3' }],
        list_complete: true
      })

    const mockKV = { get: vi.fn(), put: vi.fn(), delete: mockDelete, list: mockList } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/cache/clear', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mock-token' }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.message).toBe('All cache cleared successfully')

    expect(mockList).toHaveBeenCalledTimes(2)
    expect(mockList).toHaveBeenNthCalledWith(1, { cursor: undefined })
    expect(mockList).toHaveBeenNthCalledWith(2, { cursor: 'cursor1' })

    expect(mockDelete).toHaveBeenCalledTimes(3)
    expect(mockDelete).toHaveBeenCalledWith('key1')
    expect(mockDelete).toHaveBeenCalledWith('key2')
    expect(mockDelete).toHaveBeenCalledWith('key3')
  })

  it('Should return cache size metrics from /v1/cache/metrics with pagination', async () => {
    const mockList = vi.fn()
      .mockResolvedValueOnce({
        keys: [{ name: 'key1' }, { name: 'key2' }],
        list_complete: false,
        cursor: 'cursor1'
      })
      .mockResolvedValueOnce({
        keys: [{ name: 'key3' }],
        list_complete: true
      })
    const mockKV = { list: mockList } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/cache/metrics', {
      headers: { 'Authorization': `Bearer ${VALID_ENV.ADMIN_AUTH_TOKEN}` }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.metrics).toBeDefined()
    expect(body.metrics.total_keys).toBe(3)
    expect(mockList).toHaveBeenCalledTimes(2)
    expect(mockList).toHaveBeenNthCalledWith(1, { cursor: undefined })
    expect(mockList).toHaveBeenNthCalledWith(2, { cursor: 'cursor1' })
  })

  it('Should fail /v1/cache/metrics without admin auth', async () => {
    const mockList = vi.fn()
    const mockKV = { list: mockList } as unknown as KVNamespace
    const req = new Request('http://localhost/v1/cache/metrics')

    const res = await app.fetch(req, { ...VALID_ENV, FATHOM_KV: mockKV }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.error).toBe('unauthorized')
    // must not enumerate the namespace for an unauthenticated caller
    expect(mockList).not.toHaveBeenCalled()
  })

  it('Should fail /v1/cache/metrics if KV not configured', async () => {
    const env: FathomEnv = {}
    const req = new Request('http://localhost/v1/cache/metrics', {
      headers: { 'Authorization': `Bearer ${VALID_ENV.ADMIN_AUTH_TOKEN}` }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('internal_error')
    expect(body.message).toBe('KV not configured')
  })

  it('Should handle errors on /v1/cache/metrics gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockList = vi.fn().mockRejectedValue(new Error('KV List Error'))
    const mockKV = { list: mockList } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/cache/metrics', {
      headers: { 'Authorization': `Bearer ${VALID_ENV.ADMIN_AUTH_TOKEN}` }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('internal_error')
    expect(body.message).toBe('Failed to retrieve cache metrics')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })


  it('Should fail /v1/cache/clear if missing admin auth', async () => {
    const env: FathomEnv = {}
    const req = new Request('http://localhost/v1/cache/clear', {
      method: 'POST'
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: vi.fn() } as unknown as ExecutionContext)
    expect(res.status).toBe(401)
  })

  it('Should return total_keys as 0 if KV list is empty on /v1/cache/metrics', async () => {
    const mockList = vi.fn().mockResolvedValue({
      keys: [],
      list_complete: true
    })
    const mockKV = { list: mockList } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/cache/metrics', {
      headers: { 'Authorization': `Bearer ${VALID_ENV.ADMIN_AUTH_TOKEN}` }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.metrics).toBeDefined()
    expect(body.metrics.total_keys).toBe(0)
    expect(mockList).toHaveBeenCalledTimes(1)
  })

  it('Should handle errors thrown during pagination gracefully on /v1/cache/metrics', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockList = vi.fn()
      .mockResolvedValueOnce({
        keys: [{ name: 'key1' }],
        list_complete: false,
        cursor: 'cursor1'
      })
      .mockRejectedValueOnce(new Error('KV Pagination Error'))

    const mockKV = { list: mockList } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/cache/metrics', {
      headers: { 'Authorization': `Bearer ${VALID_ENV.ADMIN_AUTH_TOKEN}` }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('internal_error')
    expect(body.message).toBe('Failed to retrieve cache metrics')
    expect(mockList).toHaveBeenCalledTimes(2)
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('Should handle missing env object completely gracefully on /v1/cache/metrics', async () => {
    const env: any = undefined
    const req = new Request('http://localhost/v1/cache/metrics', {
      headers: { 'Authorization': `Bearer ${VALID_ENV.ADMIN_AUTH_TOKEN}` }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('internal_error')
    expect(body.message).toBe('KV not configured')
  })

  it('Should handle malformed KV list response without keys array on /v1/cache/metrics', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockList = vi.fn().mockResolvedValue({
      list_complete: true
    })
    const mockKV = { list: mockList } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/cache/metrics', {
      headers: { 'Authorization': `Bearer ${VALID_ENV.ADMIN_AUTH_TOKEN}` }
    })

    const res = await app.fetch(req, { ...VALID_ENV, ...env }, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('internal_error')
    expect(body.message).toBe('Failed to retrieve cache metrics')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

});
