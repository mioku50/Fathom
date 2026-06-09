import { describe, it, expect, vi } from 'vitest'
import app from '../src/index'
import type { PriceResponse } from '../src/schema'
import type { FathomEnv } from '../src/cache'

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
})
