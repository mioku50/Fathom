import type { PriceResponse } from './schema'

export interface FathomEnv {
  FATHOM_KV?: KVNamespace
  CACHE_DEFAULT_TTL_SECONDS?: string
}

let hits = 0
let misses = 0

export function getCacheStats() {
  return { hits, misses }
}

export function resetCacheStats() {
  hits = 0
  misses = 0
}

export class KVCacheLayer {
  private kv?: KVNamespace
  private defaultTTL: number

  constructor(kv?: KVNamespace, defaultTTL = 60) {
    this.kv = kv
    this.defaultTTL = defaultTTL
  }

  getCacheKey(token: string, chain: string): string {
    return `price:${chain.toLowerCase()}:${token.toLowerCase()}`
  }

  async get(token: string, chain: string): Promise<PriceResponse | null> {
    if (!this.kv) {
      return null
    }

    try {
      const key = this.getCacheKey(token, chain)
      const cached = await this.kv.get(key, 'json')

      if (cached) {
        hits++
        console.log(`[Cache] HIT - ${key}`)
        return cached as PriceResponse
      }
      misses++
      console.log(`[Cache] MISS - ${key}`)
    } catch (e) {
      // Ignore cache read errors to prevent them from breaking the API
      console.error('KV Cache read error:', e)
    }

    return null
  }

  async set(token: string, chain: string, response: PriceResponse, ttlSeconds?: number): Promise<void> {
    if (!this.kv) {
      return
    }

    try {
      const key = this.getCacheKey(token, chain)
      const expirationTtl = ttlSeconds ?? this.defaultTTL
      await this.kv.put(key, JSON.stringify(response), { expirationTtl })
    } catch (e) {
      // Ignore cache write errors to prevent them from breaking the API
      console.error('KV Cache write error:', e)
    }
  }
}
