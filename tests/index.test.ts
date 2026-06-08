import { describe, it, expect, vi } from 'vitest'
import app from '../src/index'
import type { PriceResponse } from '../src/schema'
import type { FathomEnv } from '../src/cache'

describe('Fathom API', () => {
  it('Should return ok for /v1/health', async () => {
    const req = new Request('http://localhost/v1/health')
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ status: 'ok', service: 'fathom-api' })
  })

  it('Should return valid schema for /v1/price (no cache)', async () => {
    const req = new Request('http://localhost/v1/price?token=0xABC&chain=base')
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as PriceResponse
    expect(body.token).toBe('0xABC')
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

  it('Should set cache on first request if FATHOM_KV is bound', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/price?token=0xDEF&chain=base')
    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as ExecutionContext)
    expect(res.status).toBe(200)

    expect(mockGet).toHaveBeenCalledWith('price:base:0xdef', 'json')
    expect(mockPut).toHaveBeenCalledWith(
      'price:base:0xdef',
      expect.any(String),
      { expirationTtl: 60 }
    )
  })

  it('Should return cached response if FATHOM_KV has it', async () => {
    const cachedResponse: PriceResponse = {
      token: '0xDEF',
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

    const req = new Request('http://localhost/v1/price?token=0xDEF&chain=base')
    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as PriceResponse
    expect(body.symbol).toBe('CACHED')

    expect(mockGet).toHaveBeenCalledWith('price:base:0xdef', 'json')
    // Put shouldn't be called if cache hit
    expect(mockPut).not.toHaveBeenCalled()
  })
})
