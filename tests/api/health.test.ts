import { describe, it, expect, vi } from 'vitest'
import app from '../../src/index'
import type { FathomEnv } from '../../src/cache'

describe('Health Check API (/v1/health)', () => {
  it('Should return ok and 200 status for /v1/health', async () => {
    const req = new Request('http://localhost/v1/health')
    const res = await app.fetch(req, { BASE_RPC_URL: 'http://localhost:8545', X402_NETWORK: 'base', X402_RECIPIENT: '0x123', X402_FACILITATOR_URL: 'http://facilitator', CACHE_DEFAULT_TTL_SECONDS: '60' }, { waitUntil: () => {} } as any)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.service).toBe('fathom-api')
    expect(body.timestamp).toBeDefined()
    expect(typeof body.timestamp).toBe('string')
    expect(body.kv_healthy).toBe(false)
  })

  it('Should return kv_healthy as true when FATHOM_KV is bound and healthy', async () => {
    const mockList = vi.fn().mockResolvedValue({ keys: [], list_complete: true })
    const mockKV = { list: mockList, get: vi.fn().mockResolvedValue('0'), put: vi.fn().mockResolvedValue(undefined) } as unknown as KVNamespace
    const env = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/health')
    const res = await app.fetch(req, { BASE_RPC_URL: 'http://localhost:8545', X402_NETWORK: 'base', X402_RECIPIENT: '0x123', X402_FACILITATOR_URL: 'http://facilitator', CACHE_DEFAULT_TTL_SECONDS: '60', ...env }, { waitUntil: () => {} } as any)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.service).toBe('fathom-api')
    expect(body.kv_healthy).toBe(true)
    expect(mockList).toHaveBeenCalledWith({ limit: 1 })
  })

  it('Should return kv_healthy as false when FATHOM_KV is bound but list operation fails', async () => {
    const mockList = vi.fn().mockRejectedValue(new Error('KV connection error'))
    const mockKV = { list: mockList, get: vi.fn().mockResolvedValue('0'), put: vi.fn().mockResolvedValue(undefined) } as unknown as KVNamespace
    const env = { FATHOM_KV: mockKV }

    // Suppress expected console.error during this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const req = new Request('http://localhost/v1/health')
    const res = await app.fetch(req, { BASE_RPC_URL: 'http://localhost:8545', X402_NETWORK: 'base', X402_RECIPIENT: '0x123', X402_FACILITATOR_URL: 'http://facilitator', CACHE_DEFAULT_TTL_SECONDS: '60', ...env }, { waitUntil: () => {} } as any)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.service).toBe('fathom-api')
    expect(body.kv_healthy).toBe(false)
    expect(consoleSpy).toHaveBeenCalledWith('KV health check failed:', expect.any(Error))

    consoleSpy.mockRestore()
  })

  it('Should apply rate limits correctly on /v1/health', async () => {
    const mockList = vi.fn().mockResolvedValue({ keys: [] })
    const mockGet = vi.fn().mockResolvedValue('60') // Simulate that the limit (60) has been reached
    const mockPut = vi.fn().mockResolvedValue(undefined)

    const mockKV = { list: mockList, get: mockGet, put: mockPut } as unknown as KVNamespace
    const env = { FATHOM_KV: mockKV }

    const req = new Request('http://localhost/v1/health')
    const res = await app.fetch(req, { BASE_RPC_URL: 'http://localhost:8545', X402_NETWORK: 'base', X402_RECIPIENT: '0x123', X402_FACILITATOR_URL: 'http://facilitator', CACHE_DEFAULT_TTL_SECONDS: '60', ...env }, { waitUntil: () => {} } as any)

    // Check that we got rate limited
    expect(res.status).toBe(429)
    const body = await res.json() as any
    expect(body.error).toBe('rate_limited')
  })
})
