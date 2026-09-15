import { describe, it, expect, vi } from 'vitest';
import {
  fathomActionProvider,
  FathomActionProvider,
  FathomAssessActionSchema
} from '../src/agentkit/fathomActionProvider.js';
import * as clientModule from '../src/core/client.js';

const VALID_TOKEN = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';

const mockAssessment = {
  token: VALID_TOKEN,
  chain: 'base',
  symbol: 'AERO',
  price_usd: 0.484,
  verdict: 'tradeable',
  reason: '$10,000 fills cleanly.',
  size_usd: 10000,
  exit: {
    fillable: true,
    proceeds_usd: 9952,
    price_impact_bps: 48,
    execution_price_usd: 0.4818
  },
  price_trust: {
    confidence: 96,
    measured_weight: 0.75,
    sources: 6,
    dispersion_bps: 40,
    twap_deviation_bps: 0.9
  },
  concerns: [],
  unverified: [],
  updated_at: '2026-08-29T10:00:00.000Z'
};

function createMockWalletProvider(network: any) {
  return {
    getAddress: () => '0x1234567890123456789012345678901234567890',
    getNetwork: () => network,
    signTypedData: vi.fn().mockResolvedValue('0x' + '1'.repeat(130))
  } as any;
}

describe('AgentKit Adapter: FathomActionProvider', () => {
  it('instantiates and provides the fathom_assess action', () => {
    const provider = fathomActionProvider();
    expect(provider).toBeInstanceOf(FathomActionProvider);
    expect(provider.name).toBe('fathom');

    const wallet = createMockWalletProvider({ chainId: '8453', networkId: 'base-mainnet' });
    const actions = provider.getActions(wallet);
    expect(actions).toHaveLength(1);
    expect(actions[0].name).toBe('fathom_assess');
    expect(actions[0].description).toContain('Base');
    expect(actions[0].schema).toBe(FathomAssessActionSchema);
  });

  it('validates action schema with valid input', () => {
    const valid = FathomAssessActionSchema.safeParse({
      token: VALID_TOKEN,
      size_usd: 5000
    });
    expect(valid.success).toBe(true);

    const invalid = FathomAssessActionSchema.safeParse({
      token: 'not-an-address'
    });
    expect(invalid.success).toBe(false);
  });

  it('supports Base mainnet only', () => {
    const provider = fathomActionProvider();

    // Base mainnet variations
    expect(provider.supportsNetwork({ protocolFamily: 'evm', chainId: '8453' } as any)).toBe(true);
    expect(provider.supportsNetwork({ protocolFamily: 'evm', networkId: 'base-mainnet' } as any)).toBe(true);
    expect(provider.supportsNetwork({ protocolFamily: 'evm', networkId: 'base' } as any)).toBe(true);

    // Other networks must be rejected
    expect(provider.supportsNetwork({ protocolFamily: 'evm', chainId: '1', networkId: 'ethereum' } as any)).toBe(false);
    expect(provider.supportsNetwork({ protocolFamily: 'evm', chainId: '84532', networkId: 'base-sepolia' } as any)).toBe(false);
    expect(provider.supportsNetwork({ protocolFamily: 'svm', chainId: 'mainnet' } as any)).toBe(false);
  });

  it('calls core client.assess exactly once and returns JSON string', async () => {
    const mockAssess = vi.fn().mockResolvedValue(mockAssessment);
    vi.spyOn(clientModule, 'createFathomClient').mockReturnValue({
      assess: mockAssess
    });

    const provider = fathomActionProvider();
    const wallet = createMockWalletProvider({ chainId: '8453', networkId: 'base-mainnet' });
    const action = provider.getActions(wallet)[0];

    const resultStr = await action.invoke({
      token: VALID_TOKEN,
      size_usd: 10000
    });

    expect(mockAssess).toHaveBeenCalledTimes(1);
    expect(mockAssess).toHaveBeenCalledWith({
      token: VALID_TOKEN,
      sizeUsd: 10000,
      chain: 'base'
    });

    const parsed = JSON.parse(resultStr);
    expect(parsed.verdict).toBe('tradeable');
    expect(parsed.token).toBe(VALID_TOKEN);
  });

  it('refuses execution on non-Base network without calling core assess', async () => {
    const mockAssess = vi.fn().mockResolvedValue(mockAssessment);
    vi.spyOn(clientModule, 'createFathomClient').mockReturnValue({
      assess: mockAssess
    });

    const provider = fathomActionProvider();
    const nonBaseWallet = createMockWalletProvider({ chainId: '1', networkId: 'ethereum' });
    const action = provider.getActions(nonBaseWallet)[0];

    await expect(
      action.invoke({
        token: VALID_TOKEN,
        size_usd: 10000
      })
    ).rejects.toThrow(/Base mainnet/);

    expect(mockAssess).toHaveBeenCalledTimes(0);
  });
});
