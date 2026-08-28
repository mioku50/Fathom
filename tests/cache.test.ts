import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KVCacheLayer, getCacheStats, resetCacheStats } from '../src/cache'
import type { PriceResponse } from '../src/schema'

const mockPriceResponse: PriceResponse = {
  token: '0xABC',
  chain: 'base',
  symbol: 'PEPE',
  price_usd: 0.00004217,
  confidence: 73,
  label: 'thin',
  liquidity_usd: 84200,
  source_count: 2,
  price_dispersion_bps: 120,
  confidence_components: {
    liquidity: { score: 0.77, weight: 0.35, effective_weight: 0.5 },
    source_agreement: { score: 0.76, weight: 0.20, effective_weight: 0.286 },
    twap_deviation: { score: null, weight: 0.20, effective_weight: 0 },
    volatility: { score: 0.66, weight: 0.15, effective_weight: 0.214 },
    maturity: { score: null, weight: 0.10, effective_weight: 0 }
  },
  main_pool: {
    dex: 'aerodrome',
    address: '0x123',
    fee: 0.003
  },
  flags: ['thin_liquidity'],
  updated_at: '2026-06-08T14:50:00Z'
}

describe('KVCacheLayer', () => {
  beforeEach(() => {
    resetCacheStats()
  })

  it('Should return null if KV is not provided', async () => {
    const cache = new KVCacheLayer()
    const result = await cache.get('0xabc', 'base')
    expect(result).toBeNull()
  })

  it('Should retrieve a cached response successfully', async () => {
    const mockGet = vi.fn().mockResolvedValue(mockPriceResponse)
    const mockKV = { get: mockGet, put: vi.fn(), delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV)
    const result = await cache.get('0xABC', 'base')

    expect(mockGet).toHaveBeenCalledWith('price:base:0xabc', 'json')
    expect(result).toEqual(mockPriceResponse)
    expect(getCacheStats()).toEqual({ hits: 1, misses: 0 })
  })

  it('Should return null if response is not cached', async () => {
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: vi.fn(), delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV)
    const result = await cache.get('0xABC', 'base')

    expect(mockGet).toHaveBeenCalledWith('price:base:0xabc', 'json')
    expect(result).toBeNull()
    expect(getCacheStats()).toEqual({ hits: 0, misses: 1 })
  })

  it('Should gracefully return null if KV throws an error on get', async () => {
    const mockGet = vi.fn().mockRejectedValue(new Error('KV connection lost'))
    const mockKV = { get: mockGet, put: vi.fn(), delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV)
    const result = await cache.get('0xABC', 'base')

    expect(result).toBeNull()
  })

  it('Should set a cache response successfully', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockKV = { get: vi.fn(), put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV)
    await cache.set('0xABC', 'base', mockPriceResponse, 60)

    expect(mockPut).toHaveBeenCalledWith(
      'price:base:0xabc',
      JSON.stringify(mockPriceResponse),
      { expirationTtl: 60 }
    )
  })

  it('Should use custom defaultTTL if provided in constructor', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockKV = { get: vi.fn(), put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV, 120)
    // pass undefined for explicit ttlSeconds
    await cache.set('0xABC', 'base', mockPriceResponse)

    expect(mockPut).toHaveBeenCalledWith(
      'price:base:0xabc',
      JSON.stringify(mockPriceResponse),
      { expirationTtl: 120 }
    )
  })

  it('Should ignore errors gracefully on cache set', async () => {
    const mockPut = vi.fn().mockRejectedValue(new Error('KV connection lost'))
    const mockKV = { get: vi.fn(), put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV)
    // This should not throw
    await cache.set('0xABC', 'base', mockPriceResponse, 60)
  })

  it('Should return null for an expired TTL', async () => {
    vi.useFakeTimers()
    const mockStore: Record<string, { value: any; expiresAt: number }> = {}

    const mockPut = vi.fn().mockImplementation(async (key, value, options) => {
      mockStore[key] = {
        value: JSON.parse(value),
        expiresAt: Date.now() + options.expirationTtl * 1000
      }
    })

    const mockGet = vi.fn().mockImplementation(async (key) => {
      const item = mockStore[key]
      if (!item) return null
      if (Date.now() >= item.expiresAt) {
        return null // Simulate TTL expiration
      }
      return item.value
    })

    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV)

    // Set item with 60 seconds TTL
    await cache.set('0xABC', 'base', mockPriceResponse, 60)

    // Verify it's in the cache immediately
    const resultBefore = await cache.get('0xABC', 'base')
    expect(resultBefore).toEqual(mockPriceResponse)

    // Advance time by 61 seconds
    vi.advanceTimersByTime(61000)

    // Verify it's expired
    const resultAfter = await cache.get('0xABC', 'base')
    expect(resultAfter).toBeNull()

    vi.useRealTimers()
  })

  it('Should handle unexpected cache eviction (miss on get after set)', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    // Even after a successful put, get returns null (simulating unexpected eviction)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV)

    // Set should succeed
    await cache.set('0xABC', 'base', mockPriceResponse, 60)

    // Get should return null cleanly and increment misses
    const result = await cache.get('0xABC', 'base')

    expect(result).toBeNull()
    expect(getCacheStats()).toEqual({ hits: 0, misses: 1 })
  })

  it('Should handle partial KV namespace failures gracefully', async () => {
    // Put throws an error, but Get works normally
    const mockPut = vi.fn().mockRejectedValue(new Error('KV write failed'))
    const mockGet = vi.fn().mockResolvedValue(mockPriceResponse)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV)

    // Put should catch the error and not crash
    await cache.set('0xABC', 'base', mockPriceResponse, 60)

    // Get should still work
    const result = await cache.get('0xABC', 'base')

    expect(result).toEqual(mockPriceResponse)
    expect(getCacheStats()).toEqual({ hits: 1, misses: 0 })
  })
})
