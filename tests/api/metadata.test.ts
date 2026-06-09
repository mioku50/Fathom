import { describe, it, expect, vi } from 'vitest';
import { getTokenMetadata } from '../../src/api/metadata';
import * as viem from 'viem';

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

describe('metadata module', () => {
  it('getTokenMetadata successfully retrieves symbol, name, and decimals', async () => {
    const mockReadContract = vi.fn().mockImplementation(async ({ functionName }) => {
      if (functionName === 'symbol') return 'TST';
      if (functionName === 'name') return 'Test Token';
      if (functionName === 'decimals') return 18;
      throw new Error(`Unknown function: ${functionName}`);
    });

    vi.mocked(viem.createPublicClient).mockReturnValue({
      readContract: mockReadContract
    } as any);

    const tokenAddress = '0x1234567890123456789012345678901234567890';
    const metadata = await getTokenMetadata(tokenAddress as viem.Address);

    expect(metadata).toEqual({
      address: tokenAddress,
      symbol: 'TST',
      name: 'Test Token',
      decimals: 18
    });
    expect(mockReadContract).toHaveBeenCalledTimes(3);
  });

  it('getTokenMetadata handles errors during fetch', async () => {
    const mockReadContract = vi.fn().mockRejectedValue(new Error('Network error'));

    vi.mocked(viem.createPublicClient).mockReturnValue({
      readContract: mockReadContract
    } as any);

    const tokenAddress = '0x1234567890123456789012345678901234567890';
    await expect(getTokenMetadata(tokenAddress as viem.Address)).rejects.toThrow(`Failed to fetch token metadata for ${tokenAddress}`);
  });
});
