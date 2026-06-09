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


describe('Fathom API Integration Test', () => {
  it('Should process a valid request, set cache, and return valid structure through /v1/price', async () => {
    // 1. Setup mock KV for cache layer integration
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    // 2. Make an end-to-end request handling validation and x402 payment
    const token = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/price?token=${token}&chain=base`, {
      headers: { 'X-PAYMENT': 'mock_payment_proof' }
    })

    // 3. Inject waitUntil and app execution
    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)

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
      headers: { 'X-PAYMENT': 'mock_payment_proof' }
    })

    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)
  })

  it('Should fail end-to-end request if x402 payment is missing', async () => {
    const env: FathomEnv = {}

    // Valid token but missing X-PAYMENT header
    const token = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/price?token=${token}&chain=base`)

    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(402)

    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe('payment_required')
  })

  it('Should successfully process batch request through /v1/metadatas', async () => {
    // Mock KV for cache layer
    const mockPut = vi.fn().mockResolvedValue(undefined)
    const mockGet = vi.fn().mockResolvedValue(null)
    const mockKV = { get: mockGet, put: mockPut, delete: vi.fn(), list: vi.fn() } as unknown as KVNamespace

    const env: FathomEnv = { FATHOM_KV: mockKV }

    const tokens = '0x1234567890123456789012345678901234567890,0x0987654321098765432109876543210987654321'
    const req = new Request(`http://localhost/v1/metadatas?tokens=${tokens}&chain=base`, {
      headers: { 'X-PAYMENT': 'mock_payment_proof' }
    })

    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
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
      headers: { 'X-PAYMENT': 'mock_payment_proof' }
    })

    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(400)

    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(body.error).toContain('Maximum 10 tokens allowed')
  })

  it('Should fail /v1/metadatas if x402 payment missing', async () => {
    const env: FathomEnv = {}
    const tokens = '0x1234567890123456789012345678901234567890'
    const req = new Request(`http://localhost/v1/metadatas?tokens=${tokens}&chain=base`)

    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)
    expect(res.status).toBe(402)
  })

  it('Should return health status and basic metrics from /v1/health', async () => {
    const env: FathomEnv = {}
    const req = new Request('http://localhost/v1/health')

    const res = await app.fetch(req, env, { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext)

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.service).toBe('fathom-api')
    expect(body.timestamp).toBeDefined()
  })

})
