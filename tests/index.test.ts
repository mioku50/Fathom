import { describe, it, expect, vi } from 'vitest'
import app from '../src/index'
import type { PriceResponse } from '../src/schema'
import type { FathomEnv } from '../src/cache'

describe('Fathom API', () => {
  it('Should return ok for /v1/health', async () => {
    const req = new Request('http://localhost/v1/health')
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ status: 'ok', service: 'fathom-api' })
  })

  it('Should return 402 payment required if no X-PAYMENT header is present', async () => {
    const req = new Request('http://localhost/v1/price?token=0xABC&chain=base')
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(402)

    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe('payment_required')
  })

  it('Should return valid schema for /v1/price (no cache)', async () => {
    const req = new Request('http://localhost/v1/price?token=0xABC&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
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

  it('Should bypass payment block if Authorization header is present', async () => {
    const req = new Request('http://localhost/v1/price?token=0xABC&chain=base', {
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
    const tokens = '1,2,3,4,5,6,7,8,9,10,11'
    const req = new Request(`http://localhost/v1/prices?tokens=${tokens}&chain=base`, {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('Maximum 10 tokens allowed per request')
  })

  it('Should return valid schema for /v1/prices (batch)', async () => {
    const req = new Request('http://localhost/v1/prices?tokens=0xABC,0xDEF&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, {}, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as PriceResponse[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(2)

    expect(body[0].token).toBe('0xABC')
    expect(body[1].token).toBe('0xDEF')

    expect(body[0].symbol).toBe('DUMMY')
    expect(body[1].symbol).toBe('DUMMY')
  })

  it('Should bypass payment block for /v1/prices if Authorization header is present', async () => {
    const req = new Request('http://localhost/v1/prices?tokens=0xABC&chain=base', {
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

    const req = new Request('http://localhost/v1/price?token=0xDEF&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
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

    const req = new Request('http://localhost/v1/price?token=0xDEF&chain=base', {
      headers: { 'X-PAYMENT': 'mock_payment' }
    })
    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(200)

    const body = await res.json() as PriceResponse
    expect(body.symbol).toBe('CACHED')

    expect(mockGet).toHaveBeenCalledWith('price:base:0xdef', 'json')
    // Put shouldn't be called if cache hit
    expect(mockPut).not.toHaveBeenCalled()
  })
})
