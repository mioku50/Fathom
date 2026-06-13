import type { FathomEnv } from '../cache'
import { createCdpAuthHeaders } from '@coinbase/x402'

export interface X402Config {
  network: `${string}:${string}`
  price: string
  payTo: `0x${string}`
  facilitatorUrl: string
  createAuthHeaders?: () => Promise<{ verify: Record<string, string>; settle: Record<string, string>; supported: Record<string, string>; bazaar?: Record<string, string> }>
}

export function parseX402Config(env?: FathomEnv): X402Config {
  if (!env) {
    throw new Error('Config missing environment')
  }

  // 1. Network normalization
  const rawNetwork = env.X402_NETWORK?.trim()
  if (!rawNetwork) {
    throw new Error('Missing X402_NETWORK in config')
  }

  let network: `${string}:${string}`
  if (rawNetwork === 'base-sepolia' || rawNetwork === 'eip155:84532') {
    network = 'eip155:84532'
  } else if (rawNetwork === 'base' || rawNetwork === 'eip155:8453') {
    network = 'eip155:8453'
  } else {
    throw new Error(`Unsupported X402_NETWORK: ${rawNetwork}`)
  }

  // 2. Price normalization
  const priceVal = env.X402_PRICE_USDC?.trim()
  if (!priceVal) {
    throw new Error('Missing X402_PRICE_USDC in config')
  }
  
  const parsedPrice = parseFloat(priceVal)
  if (isNaN(parsedPrice) || parsedPrice <= 0) {
    throw new Error(`Invalid X402_PRICE_USDC: ${priceVal}`)
  }
  // Construct valid exact-scheme price string like $0.01
  const priceString = `$${priceVal}`

  // 3. Recipient
  const payTo = env.FATHOM_X402_RECIPIENT?.trim()
  if (!payTo) {
    throw new Error('Missing FATHOM_X402_RECIPIENT in config')
  }
  if (!payTo.startsWith('0x')) {
    throw new Error('Invalid FATHOM_X402_RECIPIENT: must start with 0x')
  }
  
  if (network === 'eip155:8453') {
    const isZero = /^0x0+$/.test(payTo)
    if (isZero) {
      throw new Error('Zero address FATHOM_X402_RECIPIENT is not allowed in production')
    }
  }

  // 4. Facilitator
  const facilitatorUrl = env.FATHOM_X402_FACILITATOR_URL?.trim()
  if (!facilitatorUrl) {
    throw new Error('Missing FATHOM_X402_FACILITATOR_URL in config')
  }

  const isMainnet = network === 'eip155:8453'
  const isCdpFacilitator = facilitatorUrl === 'https://api.cdp.coinbase.com/platform/v2/x402'
  const isStagingFacilitator = facilitatorUrl === 'https://x402.org/facilitator'
  let createAuthHeaders: undefined | (() => Promise<{ verify: Record<string, string>; settle: Record<string, string>; supported: Record<string, string>; bazaar?: Record<string, string> }>) = undefined

  if (isMainnet) {
    if (isStagingFacilitator) {
      throw new Error('Mainnet x402 production cannot use the x402.org testnet facilitator')
    }
    if (!isCdpFacilitator) {
      throw new Error('Mainnet x402 production requires the CDP facilitator (https://api.cdp.coinbase.com/platform/v2/x402)')
    }

    const cdpKeyId = env.CDP_API_KEY_ID?.trim()
    const cdpKeySecret = env.CDP_API_KEY_SECRET?.trim()

    if (!cdpKeyId) {
      throw new Error('Missing CDP_API_KEY_ID in config for mainnet facilitator')
    }
    if (!cdpKeySecret) {
      throw new Error('Missing CDP_API_KEY_SECRET in config for mainnet facilitator')
    }

    const authHeadersMap = createCdpAuthHeaders(cdpKeyId, cdpKeySecret)
    
    // Convert the map returned by createCdpAuthHeaders to the format expected by HTTPFacilitatorClient
    createAuthHeaders = async () => (authHeadersMap as unknown) as { verify: Record<string, string>; settle: Record<string, string>; supported: Record<string, string>; bazaar?: Record<string, string> }
  } else {
    // For staging/base-sepolia
    if (isCdpFacilitator) {
      // It's possible to use CDP on testnet if desired, but user said "preserve existing flow"
    }
  }

  return {
    network,
    price: priceString,
    payTo: payTo as `0x${string}`,
    facilitatorUrl,
    createAuthHeaders
  }
}

