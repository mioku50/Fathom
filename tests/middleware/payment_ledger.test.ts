import { describe, it, expect, vi, afterEach } from 'vitest'
import { encodePaymentResponseHeader } from '@x402/core/http'
import {
  PAYMENT_LEDGER_PREFIX_V1,
  PAYMENT_LEDGER_TTL_SECONDS_V1,
  maskAddressV1,
  recordSettledPaymentV1,
  settledPaymentOfV1,
  userAgentOfV1,
  type PaymentLedgerEntryV1,
} from '../../src/middleware/paymentLedger'

const PAYER = '0xABCD00000000000000000000000000000000EF01'
const TX = `0x${'ab'.repeat(32)}`

function header(settle: Record<string, unknown>): string {
  return encodePaymentResponseHeader(settle as any)
}

describe('the payment ledger', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads a settled payment from PAYMENT-RESPONSE, and nothing from one that did not settle', () => {
    expect(settledPaymentOfV1(header({ success: true, payer: PAYER, transaction: TX, network: 'eip155:8453' }))).toEqual({
      payer: PAYER.toLowerCase(),
      transaction: TX,
      network: 'eip155:8453',
    })
    expect(settledPaymentOfV1(header({ success: false, errorReason: 'insufficient_funds', transaction: '', network: 'eip155:8453' }))).toBeNull()
    expect(settledPaymentOfV1('not a header')).toBeNull()
    expect(settledPaymentOfV1(undefined)).toBeNull()
    // A malformed address or hash is kept as unknown, never as something else.
    expect(settledPaymentOfV1(header({ success: true, payer: 'nobody', transaction: '0x12', network: 'eip155:8453' }))).toEqual({
      payer: null,
      transaction: null,
      network: 'eip155:8453',
    })
  })

  it('keeps the entry a year and a month in KV, and says it once in the log with the payer cut short', async () => {
    const put = vi.fn(async () => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const entry: PaymentLedgerEntryV1 = {
      v: 1,
      at: '2026-11-16T00:43:29.000Z',
      path: '/v1/assess',
      price: '$0.001',
      payer: PAYER.toLowerCase(),
      transaction: TX,
      network: 'eip155:8453',
      userAgent: 'lumiere-paycheck-prober/1.0',
    }
    await recordSettledPaymentV1({ FATHOM_KV: { put } as any }, entry)
    expect(put).toHaveBeenCalledWith(`${PAYMENT_LEDGER_PREFIX_V1}2026-11-16T00:43:29.000Z:${TX}`, JSON.stringify(entry), {
      expirationTtl: PAYMENT_LEDGER_TTL_SECONDS_V1,
    })
    const line = JSON.parse(String(log.mock.calls[0]?.[0]))
    expect(line).toMatchObject({ event: 'x402_settled', path: '/v1/assess', payer: '0xabcd…ef01', userAgent: 'lumiere-paycheck-prober/1.0' })
    expect(String(log.mock.calls[0]?.[0])).not.toContain(PAYER.toLowerCase())
  })

  it('a failed write is logged and never thrown at a paid answer', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const put = vi.fn(async () => { throw new Error('KV unavailable') })
    await expect(recordSettledPaymentV1({ FATHOM_KV: { put } as any }, {
      v: 1, at: '2026-11-16T00:00:00.000Z', path: '/v1/price', price: '$0.001', payer: null, transaction: null, network: null, userAgent: null,
    })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('X402_LEDGER_WRITE_FAILED', 'KV unavailable')
  })

  it('a client name is bounded and has no control characters', () => {
    expect(userAgentOfV1('a\u0000b\nc')).toBe('a b c')
    expect(userAgentOfV1('x'.repeat(300))?.length).toBe(200)
    expect(userAgentOfV1(undefined)).toBeNull()
    expect(maskAddressV1(null)).toBeNull()
  })
})
