import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../../src/index'
import { KVCacheLayer } from '../../src/cache'

describe('Cache Invalidation API', () => {
  let mockKV: any;

  beforeEach(() => {
    mockKV = {
      get: vi.fn().mockResolvedValue('0'),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [], list_complete: true })
    }

    // Removed global.fetch mock to test real x402Middleware path
  });

  const getEnv = (kv: any) => ({
    BASE_RPC_URL: 'http://localhost:8545',
    X402_NETWORK: 'base-sepolia',
    FATHOM_X402_RECIPIENT: '0x123',
    X402_PRICE_USDC: '0.01',
    FATHOM_X402_FACILITATOR_URL: 'http://facilitator', // This is what src/utils/env.ts expects
    CACHE_DEFAULT_TTL_SECONDS: '60',
    ADMIN_AUTH_TOKEN: 'admin-secret',
    FATHOM_KV: kv
  });

  describe('POST /v1/cache/invalidate', () => {
    it('Should return 400 if neither token nor pool is provided', async () => {
      const req = new Request('http://localhost/v1/cache/invalidate', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(mockKV), { waitUntil: () => {} } as any)
      expect(res.status).toBe(400)
      const body = await res.json() as any
      expect(body.error).toBe('invalid_request')
    })

    it('Should delete cache for token if provided', async () => {
      const req = new Request('http://localhost/v1/cache/invalidate?token=0xabc', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(mockKV), { waitUntil: () => {} } as any)
      expect(res.status).toBe(200)
      expect(mockKV.delete).toHaveBeenCalledWith('price:base:0xabc')
    })

    it('Should delete cache for pool if provided', async () => {
      const req = new Request('http://localhost/v1/cache/invalidate?pool=0xdef', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(mockKV), { waitUntil: () => {} } as any)
      expect(res.status).toBe(200)
      expect(mockKV.delete).toHaveBeenCalledWith('orchestrator:pools:0xdef')
      expect(mockKV.delete).toHaveBeenCalledWith('orchestrator:raw:0xdef')
    })

    it('Should return 500 if KV delete fails', async () => {
      mockKV.delete.mockRejectedValue(new Error('KV error'))
      const req = new Request('http://localhost/v1/cache/invalidate?token=0xabc', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(mockKV), { waitUntil: () => {} } as any)
      expect(res.status).toBe(500)
    })
  })

  describe('POST /v1/cache/clear/pool', () => {
    it('Should return 400 if pool is not provided', async () => {
      const req = new Request('http://localhost/v1/cache/clear/pool', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(mockKV), { waitUntil: () => {} } as any)
      expect(res.status).toBe(400)
      const body = await res.json() as any
      expect(body.error).toBe('invalid_request')
    })

    it('Should return 500 if KV is not configured', async () => {
      const req = new Request('http://localhost/v1/cache/clear/pool?pool=0xdef', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(undefined), { waitUntil: () => {} } as any)
      expect(res.status).toBe(500)
    })

    it('Should delete pool cache if pool is provided', async () => {
      const req = new Request('http://localhost/v1/cache/clear/pool?pool=0xdef', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(mockKV), { waitUntil: () => {} } as any)
      expect(res.status).toBe(200)
      expect(mockKV.delete).toHaveBeenCalledWith('orchestrator:pools:0xdef')
      expect(mockKV.delete).toHaveBeenCalledWith('orchestrator:raw:0xdef')
    })

    it('Should return 500 if KV delete fails', async () => {
      mockKV.delete.mockRejectedValue(new Error('KV error'))
      const req = new Request('http://localhost/v1/cache/clear/pool?pool=0xdef', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(mockKV), { waitUntil: () => {} } as any)
      expect(res.status).toBe(500)
    })
  })

  describe('POST /v1/cache/clear', () => {
    it('Should return 500 if KV is not configured', async () => {
      const req = new Request('http://localhost/v1/cache/clear', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(undefined), { waitUntil: () => {} } as any)
      expect(res.status).toBe(500)
    })

    it('Should delete all keys from KV', async () => {
      mockKV.list.mockResolvedValueOnce({
        keys: [{ name: 'key1' }, { name: 'key2' }],
        list_complete: false,
        cursor: 'cursor1'
      }).mockResolvedValueOnce({
        keys: [{ name: 'key3' }],
        list_complete: true
      });

      const req = new Request('http://localhost/v1/cache/clear', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(mockKV), { waitUntil: () => {} } as any)
      expect(res.status).toBe(200)
      expect(mockKV.list).toHaveBeenCalledTimes(2)
      expect(mockKV.delete).toHaveBeenCalledWith('key1')
      expect(mockKV.delete).toHaveBeenCalledWith('key2')
      expect(mockKV.delete).toHaveBeenCalledWith('key3')
    })

    it('Should return 500 if KV list fails', async () => {
      mockKV.list.mockRejectedValue(new Error('KV error'))
      const req = new Request('http://localhost/v1/cache/clear', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin-secret'
        }
      })
      const res = await app.fetch(req, getEnv(mockKV), { waitUntil: () => {} } as any)
      expect(res.status).toBe(500)
    })
  })
})
