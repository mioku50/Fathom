import { decodePaymentResponseHeader } from '@x402/core/http'
import type { FathomEnv } from '../cache'

// Who paid, for what, and as which client (2026-11-16).
//
// Fathom and Miorail are paid to one address, and until this ledger the only
// record of a Fathom sale was the USDC transfer itself: a payer and an amount,
// with nothing saying which endpoint was bought or which client bought it. A
// verification bot and an agent buying a pre-trade check look the same there.
// The client's own User-Agent tells them apart, so it is kept beside the
// payment. Nothing here can refuse or delay a paid answer: the write runs after
// the response and its failure is only logged.

export interface PaymentLedgerEntryV1 {
  v: 1
  at: string
  path: string
  /** The route's configured price, as the challenge named it. */
  price: string
  /** The EIP-3009 authorizer the facilitator reported, in lower case. */
  payer: string | null
  transaction: string | null
  network: string | null
  userAgent: string | null
}

export const PAYMENT_LEDGER_PREFIX_V1 = 'ledger:v1:'
/** A little over a year, so a year-on-year count still has its first month. */
export const PAYMENT_LEDGER_TTL_SECONDS_V1 = 400 * 24 * 60 * 60

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const TX_HASH = /^0x[0-9a-fA-F]{64}$/

/** A settled payment from the PAYMENT-RESPONSE header, or null when there was none or it did not settle. */
export function settledPaymentOfV1(header: string | null | undefined): { payer: string | null; transaction: string | null; network: string | null } | null {
  if (!header) return null
  try {
    const settled = decodePaymentResponseHeader(header) as { success?: boolean; payer?: unknown; transaction?: unknown; network?: unknown }
    if (settled.success !== true) return null
    return {
      payer: typeof settled.payer === 'string' && ADDRESS.test(settled.payer) ? settled.payer.toLowerCase() : null,
      transaction: typeof settled.transaction === 'string' && TX_HASH.test(settled.transaction) ? settled.transaction.toLowerCase() : null,
      network: typeof settled.network === 'string' ? settled.network.slice(0, 40) : null,
    }
  } catch {
    return null
  }
}

/** A client's own name for itself, bounded and with no control characters. */
export function userAgentOfV1(value: string | null | undefined): string | null {
  // eslint-disable-next-line no-control-regex
  const clean = (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200)
  return clean || null
}

export function maskAddressV1(address: string | null): string | null {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null
}

export function paymentLedgerKeyV1(entry: PaymentLedgerEntryV1): string {
  return `${PAYMENT_LEDGER_PREFIX_V1}${entry.at}:${entry.transaction ?? crypto.randomUUID()}`
}

/** Kept in KV, and said once in the Worker's log with the payer cut short. */
export async function recordSettledPaymentV1(env: FathomEnv | undefined, entry: PaymentLedgerEntryV1): Promise<void> {
  console.log(JSON.stringify({
    event: 'x402_settled',
    path: entry.path,
    price: entry.price,
    payer: maskAddressV1(entry.payer),
    transaction: entry.transaction,
    userAgent: entry.userAgent,
  }))
  if (!env?.FATHOM_KV) return
  try {
    await env.FATHOM_KV.put(paymentLedgerKeyV1(entry), JSON.stringify(entry), { expirationTtl: PAYMENT_LEDGER_TTL_SECONDS_V1 })
  } catch (err: any) {
    console.error('X402_LEDGER_WRITE_FAILED', err?.message ?? String(err))
  }
}
