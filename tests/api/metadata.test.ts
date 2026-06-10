import { describe, it, expect, vi } from 'vitest';
import { getTokenMetadata, getBatchTokenMetadata } from '../../src/api/metadata';
import * as viem from 'viem';
import * as viemChains from 'viem/chains';

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


  it('getTokenMetadata uses baseSepolia chain when network is base-sepolia', async () => {
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
    await getTokenMetadata(tokenAddress as viem.Address, undefined, 'base-sepolia');

    expect(viem.createPublicClient).toHaveBeenCalledWith(expect.objectContaining({
      chain: viemChains.baseSepolia
    }));
  });

  it('getTokenMetadata uses base chain by default', async () => {
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
    await getTokenMetadata(tokenAddress as viem.Address);

    expect(viem.createPublicClient).toHaveBeenCalledWith(expect.objectContaining({
      chain: viemChains.base
    }));
  });

  it('getTokenMetadata handles errors during fetch', async () => {
    const mockReadContract = vi.fn().mockRejectedValue(new Error('Network error'));

    vi.mocked(viem.createPublicClient).mockReturnValue({
      readContract: mockReadContract
    } as any);

    const tokenAddress = '0x1234567890123456789012345678901234567890';
    await expect(getTokenMetadata(tokenAddress as viem.Address)).rejects.toThrow(`Failed to fetch token metadata for ${tokenAddress}`);
  });

  it('getBatchTokenMetadata successfully retrieves metadata for multiple tokens', async () => {
    const mockReadContract = vi.fn().mockImplementation(async ({ address, functionName }) => {
      if (address === '0x1234567890123456789012345678901234567890') {
        if (functionName === 'symbol') return 'TST1';
        if (functionName === 'name') return 'Test Token 1';
        if (functionName === 'decimals') return 18;
      }
      if (address === '0x0987654321098765432109876543210987654321') {
        if (functionName === 'symbol') return 'TST2';
        if (functionName === 'name') return 'Test Token 2';
        if (functionName === 'decimals') return 6;
      }
      throw new Error(`Unknown address ${address} or function ${functionName}`);
    });

    vi.mocked(viem.createPublicClient).mockReturnValue({
      readContract: mockReadContract
    } as any);

    const tokens = [
      '0x1234567890123456789012345678901234567890',
      '0x0987654321098765432109876543210987654321'
    ];

    const metadataBatch = await getBatchTokenMetadata(tokens as viem.Address[]);

    expect(metadataBatch).toHaveLength(2);
    expect(metadataBatch[0]).toEqual({
      address: tokens[0],
      symbol: 'TST1',
      name: 'Test Token 1',
      decimals: 18
    });
    expect(metadataBatch[1]).toEqual({
      address: tokens[1],
      symbol: 'TST2',
      name: 'Test Token 2',
      decimals: 6
    });
    expect(mockReadContract).toHaveBeenCalledTimes(6);
  });

  it('getBatchTokenMetadata handles errors if any token fetch fails', async () => {
    const mockReadContract = vi.fn().mockImplementation(async ({ address }) => {
      if (address === '0x0987654321098765432109876543210987654321') {
        throw new Error('Network error');
      }
      return 'TST';
    });

    vi.mocked(viem.createPublicClient).mockReturnValue({
      readContract: mockReadContract
    } as any);

    const tokens = [
      '0x1234567890123456789012345678901234567890',
      '0x0987654321098765432109876543210987654321'
    ];

    await expect(getBatchTokenMetadata(tokens as viem.Address[])).rejects.toThrow('Failed to fetch batch token metadata');
  });
});
