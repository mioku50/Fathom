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

    // We need to mock global fetch because x402Middleware fetches the facilitator
    global.fetch = vi.fn().mockImplementation((url: any, options: any) => {
      const urlStr = url.toString()
      if (urlStr.includes('supported') || urlStr.includes('kinds')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', asset: 'usdc' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (urlStr.includes('verify')) {
        return Promise.resolve(new Response(JSON.stringify({ isValid: true, payer: '0xabc' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true, transaction: '0x123', network: 'eip155:84532' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    });
  });

  const getEnv = (kv: any) => ({
    BASE_RPC_URL: 'http://localhost:8545',
    X402_NETWORK: 'base',
    X402_RECIPIENT: '0x123',
    FATHOM_X402_RECIPIENT: '0x123',
    FATHOM_X402_FACILITATOR_URL: 'http://facilitator',
    X402_FACILITATOR_URL: 'http://facilitator', // This is what src/utils/env.ts expects
    CACHE_DEFAULT_TTL_SECONDS: '60',
    FATHOM_KV: kv
  });

  describe('POST /v1/cache/invalidate', () => {
    it('Should return 400 if neither token nor pool is provided', async () => {
      const req = new Request('http://localhost/v1/cache/invalidate', {
        method: 'POST',
        headers: {
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
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
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
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
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
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
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
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
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
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
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
        }
      })
      const res = await app.fetch(req, getEnv(undefined), { waitUntil: () => {} } as any)
      expect(res.status).toBe(500)
    })

    it('Should delete pool cache if pool is provided', async () => {
      const req = new Request('http://localhost/v1/cache/clear/pool?pool=0xdef', {
        method: 'POST',
        headers: {
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
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
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
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
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
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
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
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
          'Payment-Signature': `eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnsic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZWlwMTU1Ojg0NTMyIiwiYW1vdW50IjoiJDAuMDEiLCJhc3NldCI6InVzZGMiLCJwYXlUbyI6IjB4MTIzIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fSwicGF5bG9hZCI6eyJzaWduYXR1cmUiOiJtb2NrIn19`
        }
      })
      const res = await app.fetch(req, getEnv(mockKV), { waitUntil: () => {} } as any)
      expect(res.status).toBe(500)
    })
  })
})
