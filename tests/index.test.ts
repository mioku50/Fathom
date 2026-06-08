import { describe, it, expect } from 'vitest'
import app from '../src/index'

describe('Fathom API', () => {
  it('Should return ok for /v1/health', async () => {
    const req = new Request('http://localhost/v1/health')
    const res = await app.fetch(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ status: 'ok', service: 'fathom-api' })
  })
})
