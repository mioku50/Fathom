import { describe, it, expect } from 'vitest'
import { parseX402Config } from '../../src/utils/x402_config'

describe('parseX402Config', () => {
  const baseValidEnv = {
    X402_NETWORK: 'base-sepolia',
    X402_PRICE_USDC: '0.01',
    FATHOM_X402_RECIPIENT: '0x123',
    FATHOM_X402_FACILITATOR_URL: 'https://x402.org/facilitator'
  }

  it('normalizes base-sepolia to eip155:84532', () => {
    const config = parseX402Config({ ...baseValidEnv, X402_NETWORK: 'base-sepolia' })
    expect(config.network).toBe('eip155:84532')
  })

  it('normalizes eip155:84532 to eip155:84532', () => {
    const config = parseX402Config({ ...baseValidEnv, X402_NETWORK: 'eip155:84532' })
    expect(config.network).toBe('eip155:84532')
  })

  it('normalizes base to eip155:8453', () => {
    const config = parseX402Config({ 
      ...baseValidEnv, 
      X402_NETWORK: 'base',
      FATHOM_X402_FACILITATOR_URL: 'https://api.cdp.coinbase.com/platform/v2/x402',
      CDP_API_KEY_ID: 'id',
      CDP_API_KEY_SECRET: 'secret'
    })
    expect(config.network).toBe('eip155:8453')
  })

  it('normalizes eip155:8453 to eip155:8453', () => {
    const config = parseX402Config({ 
      ...baseValidEnv, 
      X402_NETWORK: 'eip155:8453',
      FATHOM_X402_FACILITATOR_URL: 'https://api.cdp.coinbase.com/platform/v2/x402',
      CDP_API_KEY_ID: 'id',
      CDP_API_KEY_SECRET: 'secret'
    })
    expect(config.network).toBe('eip155:8453')
  })

  it('throws config error on unsupported network', () => {
    expect(() => parseX402Config({ ...baseValidEnv, X402_NETWORK: 'polygon' })).toThrow(/Unsupported X402_NETWORK/)
  })

  it('throws config error on missing price', () => {
    expect(() => parseX402Config({ ...baseValidEnv, X402_PRICE_USDC: undefined })).toThrow(/Missing X402_PRICE_USDC/)
    expect(() => parseX402Config({ ...baseValidEnv, X402_PRICE_USDC: '' })).toThrow(/Missing X402_PRICE_USDC/)
  })

  it('throws config error on invalid price', () => {
    expect(() => parseX402Config({ ...baseValidEnv, X402_PRICE_USDC: 'abc' })).toThrow(/Invalid X402_PRICE_USDC/)
    expect(() => parseX402Config({ ...baseValidEnv, X402_PRICE_USDC: '-1' })).toThrow(/Invalid X402_PRICE_USDC/)
  })

  it('formats price correctly', () => {
    const config = parseX402Config({ ...baseValidEnv, X402_PRICE_USDC: '0.005' })
    expect(config.price).toBe('$0.005')
  })

  it('throws config error on missing recipient', () => {
    expect(() => parseX402Config({ ...baseValidEnv, FATHOM_X402_RECIPIENT: undefined })).toThrow(/Missing FATHOM_X402_RECIPIENT/)
    expect(() => parseX402Config({ ...baseValidEnv, FATHOM_X402_RECIPIENT: '' })).toThrow(/Missing FATHOM_X402_RECIPIENT/)
  })

  it('throws config error on invalid recipient prefix', () => {
    expect(() => parseX402Config({ ...baseValidEnv, FATHOM_X402_RECIPIENT: 'abc' })).toThrow(/must start with 0x/)
  })

  it('allows zero address recipient for staging network', () => {
    const config = parseX402Config({ 
      ...baseValidEnv, 
      X402_NETWORK: 'base-sepolia', 
      FATHOM_X402_RECIPIENT: '0x0000000000000000000000000000000000000000' 
    })
    expect(config.payTo).toBe('0x0000000000000000000000000000000000000000')
  })

  it('rejects zero address recipient for mainnet production config', () => {
    expect(() => parseX402Config({ 
      ...baseValidEnv, 
      X402_NETWORK: 'base', 
      FATHOM_X402_RECIPIENT: '0x0000000000000000000000000000000000000000',
      FATHOM_X402_FACILITATOR_URL: 'https://api.cdp.coinbase.com/platform/v2/x402',
      CDP_API_KEY_ID: 'id',
      CDP_API_KEY_SECRET: 'secret'
    })).toThrow(/Zero address FATHOM_X402_RECIPIENT is not allowed in production/)
  })

  it('throws config error on missing facilitator', () => {
    expect(() => parseX402Config({ ...baseValidEnv, FATHOM_X402_FACILITATOR_URL: undefined })).toThrow(/Missing FATHOM_X402_FACILITATOR_URL/)
  })

  it('valid staging config builds x402 accept requirements', () => {
    const config = parseX402Config(baseValidEnv)
    expect(config).toEqual({
      network: 'eip155:84532',
      price: '$0.01',
      payTo: '0x123',
      facilitatorUrl: 'https://x402.org/facilitator'
    })
  })

  it('throws config error if mainnet uses x402.org testnet facilitator', () => {
    expect(() => parseX402Config({
      ...baseValidEnv,
      X402_NETWORK: 'eip155:8453',
      FATHOM_X402_FACILITATOR_URL: 'https://x402.org/facilitator'
    })).toThrow(/Mainnet x402 production cannot use the x402.org testnet facilitator/)
  })

  it('throws config error if mainnet does not use CDP facilitator', () => {
    expect(() => parseX402Config({
      ...baseValidEnv,
      X402_NETWORK: 'eip155:8453',
      FATHOM_X402_FACILITATOR_URL: 'https://other.org/facilitator'
    })).toThrow(/Mainnet x402 production requires the CDP facilitator/)
  })

  it('throws config error if mainnet CDP facilitator is missing CDP_API_KEY_ID', () => {
    expect(() => parseX402Config({
      ...baseValidEnv,
      X402_NETWORK: 'eip155:8453',
      FATHOM_X402_FACILITATOR_URL: 'https://api.cdp.coinbase.com/platform/v2/x402',
      CDP_API_KEY_SECRET: 'secret'
    })).toThrow(/Missing CDP_API_KEY_ID in config for mainnet facilitator/)
  })

  it('throws config error if mainnet CDP facilitator is missing CDP_API_KEY_SECRET', () => {
    expect(() => parseX402Config({
      ...baseValidEnv,
      X402_NETWORK: 'eip155:8453',
      FATHOM_X402_FACILITATOR_URL: 'https://api.cdp.coinbase.com/platform/v2/x402',
      CDP_API_KEY_ID: 'id'
    })).toThrow(/Missing CDP_API_KEY_SECRET in config for mainnet facilitator/)
  })

  it('valid mainnet config builds x402 accept requirements with CDP keys', () => {
    const config = parseX402Config({
      ...baseValidEnv,
      X402_NETWORK: 'eip155:8453',
      X402_PRICE_USDC: '0.001',
      FATHOM_X402_RECIPIENT: '0xabc',
      FATHOM_X402_FACILITATOR_URL: 'https://api.cdp.coinbase.com/platform/v2/x402',
      CDP_API_KEY_ID: 'id',
      CDP_API_KEY_SECRET: 'secret'
    })
    expect(config.network).toBe('eip155:8453')
    expect(config.price).toBe('$0.001')
    expect(config.payTo).toBe('0xabc')
    expect(config.facilitatorUrl).toBe('https://api.cdp.coinbase.com/platform/v2/x402')
    expect(config.createAuthHeaders).toBeDefined()
  })
})
