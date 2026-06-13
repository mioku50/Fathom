import type { FathomEnv } from '../cache'

export interface X402Config {
  network: string
  price: string
  payTo: `0x${string}`
  facilitatorUrl: string
}

export function parseX402Config(env?: FathomEnv): X402Config {
  if (!env) {
    throw new Error('Config missing environment')
  }

  // 1. Network normalization
  let network = env.X402_NETWORK?.trim()
  if (!network) {
    throw new Error('Missing X402_NETWORK in config')
  }

  if (network === 'base-sepolia' || network === 'eip155:84532') {
    network = 'eip155:84532'
  } else if (network === 'base' || network === 'eip155:8453') {
    network = 'eip155:8453'
  } else {
    throw new Error(`Unsupported X402_NETWORK: ${network}`)
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

  return {
    network,
    price: priceString,
    payTo: payTo as `0x${string}`,
    facilitatorUrl
  }
}
