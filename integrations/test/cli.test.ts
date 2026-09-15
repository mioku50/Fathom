import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../bin/fathom-assess.js';
import * as clientModule from '../src/core/client.js';
import * as transportModule from '../src/x402/transport.js';

const VALID_TOKEN = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';
const DUMMY_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';

describe('CLI: bin/fathom-assess.ts', () => {
  const originalEnv = { ...process.env };
  let exitMock: any;
  let consoleErrorMock: any;
  let consoleLogMock: any;

  beforeEach(() => {
    process.env = { ...originalEnv };
    exitMock = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);
    consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogMock = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('rejects execution when private key is passed as a CLI flag', async () => {
    for (const flag of ['--private-key=0x123', '--key=0x123', '-k', '0x123']) {
      await expect(main(['--token', VALID_TOKEN, flag])).rejects.toThrow('process.exit called');
      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringMatching(/private key.*never.*passed as cli arguments/i)
      );
    }
  });

  it('fails when private key is missing from environment', async () => {
    delete process.env.FATHOM_PRIVATE_KEY;
    delete process.env.PRIVATE_KEY;

    await expect(main(['--token', VALID_TOKEN])).rejects.toThrow('process.exit called');
    expect(consoleErrorMock).toHaveBeenCalledWith(
      expect.stringMatching(/private key required/i)
    );
  });

  it('fails when --token is missing', async () => {
    process.env.FATHOM_PRIVATE_KEY = DUMMY_PRIVATE_KEY;

    await expect(main(['--size-usd', '10000'])).rejects.toThrow('process.exit called');
    expect(consoleErrorMock).toHaveBeenCalledWith(
      expect.stringMatching(/--token.*required/i)
    );
  });

  it('executes assessment with valid arguments and outputs JSON', async () => {
    process.env.FATHOM_PRIVATE_KEY = DUMMY_PRIVATE_KEY;

    const mockAssess = vi.fn().mockResolvedValue({
      token: VALID_TOKEN,
      verdict: 'tradeable',
      reason: 'Liquid',
      size_usd: 5000
    });

    vi.spyOn(clientModule, 'createFathomClient').mockReturnValue({
      assess: mockAssess
    });

    vi.spyOn(transportModule, 'createFathomX402Fetch').mockReturnValue(
      vi.fn() as any
    );

    await main(['--token', VALID_TOKEN, '--size-usd', '5000', '--chain', 'base']);

    expect(mockAssess).toHaveBeenCalledWith({
      token: VALID_TOKEN,
      sizeUsd: 5000,
      chain: 'base'
    });
    expect(consoleLogMock).toHaveBeenCalledWith(expect.stringContaining('tradeable'));
  });
});
