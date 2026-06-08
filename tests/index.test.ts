import { describe, it, expect } from 'vitest'
import app from '../src/index'
import type { PriceResponse } from '../src/schema'

describe('Fathom API', () => {
  it('Should return ok for /v1/health', async () => {
    const req = new Request('http://localhost/v1/health')
    const res = await app.fetch(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ status: 'ok', service: 'fathom-api' })
  })

  it('Should return valid schema for /v1/price', async () => {
    const req = new Request('http://localhost/v1/price?token=0xABC&chain=base')
    const res = await app.fetch(req)
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
})
