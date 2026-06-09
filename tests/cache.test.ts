import { describe, it, expect, vi } from 'vitest'
import { KVCacheLayer } from '../src/cache'
import type { PriceResponse } from '../src/schema'

const mockPriceResponse: PriceResponse = {
  token: '0xABC',
  chain: 'base',
  symbol: 'PEPE',
  price_usd: 0.00004217,
  price_low: 0.00004102,
  price_high: 0.00004331,
  twap_5m: 0.00004198,
  confidence: 73,
  label: 'thin',
  liquidity_usd: 84200,
  main_pool: {
    dex: 'aerodrome',
    address: '0x123',
    fee: 0.003
  },
  flags: ['thin_liquidity'],
  updated_at: '2026-06-08T14:50:00Z'
}

describe('KVCacheLayer', () => {
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
  })

  it('Should return null if response is not cached', async () => {
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: vi.fn(), delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV)
    const result = await cache.get('0xABC', 'base')

    expect(mockGet).toHaveBeenCalledWith('price:base:0xabc', 'json')
    expect(result).toBeNull()
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

  it('Should ignore errors gracefully on cache set', async () => {
    const mockPut = vi.fn().mockRejectedValue(new Error('KV connection lost'))
    const mockKV = { get: vi.fn(), put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const cache = new KVCacheLayer(mockKV)
    // This should not throw
    await cache.set('0xABC', 'base', mockPriceResponse, 60)
  })
})
