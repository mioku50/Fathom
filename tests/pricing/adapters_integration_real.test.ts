import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniswapV2Adapter } from '../../src/adapters/uniswap_v2';
import { UniswapV3Adapter } from '../../src/adapters/uniswap_v3';
import { AerodromeAdapter } from '../../src/adapters/aerodrome';
import { DEXAdapter } from '../../src/dex_adapter';
import { DEXOrchestrator } from '../../src/orchestrator';

describe('Real Adapters in Orchestrator', () => {
  it('should correctly register and identify all adapters', () => {
    const adapters: DEXAdapter[] = [
      new UniswapV2Adapter('http://localhost:8545'),
      new UniswapV3Adapter('http://localhost:8545'),
      new AerodromeAdapter('http://localhost:8545')
    ];

    const orchestrator = new DEXOrchestrator(adapters);

    // We can verify that the adapters are correctly instantiated and have expected IDs
    expect(adapters[0].id).toBe('uniswap_v2');
    expect(adapters[1].id).toBe('uniswap_v3');
    expect(adapters[2].id).toBe('aerodrome');
  });

  it('should pass typechecks and interface compliance for real adapters', () => {
    const v2Adapter: DEXAdapter = new UniswapV2Adapter('http://localhost:8545');
    const v3Adapter: DEXAdapter = new UniswapV3Adapter('http://localhost:8545');
    const aerodromeAdapter: DEXAdapter = new AerodromeAdapter('http://localhost:8545');

    expect(v2Adapter).toHaveProperty('getPools');
    expect(v2Adapter).toHaveProperty('getRawData');

    expect(v3Adapter).toHaveProperty('getPools');
    expect(v3Adapter).toHaveProperty('getRawData');

    expect(aerodromeAdapter).toHaveProperty('getPools');
    expect(aerodromeAdapter).toHaveProperty('getRawData');
  });

  it('orchestrator should handle RPC rate limits gracefully across real adapters during getAllPools', async () => {
    const v2Adapter = new UniswapV2Adapter('http://localhost:8545');
    const v3Adapter = new UniswapV3Adapter('http://localhost:8545');

    // Mock the internal viem clients
    const mockV2Client = { readContract: vi.fn() };
    const mockV3Client = { readContract: vi.fn() };

    (v2Adapter as any).client = mockV2Client;
    (v3Adapter as any).client = mockV3Client;

    const orchestrator = new DEXOrchestrator([v2Adapter, v3Adapter]);

    // Suppress expected console errors
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // v2 fails with rate limit, v3 succeeds
    mockV2Client.readContract.mockRejectedValue(new Error('RPC rate limit exceeded (429)'));
    mockV3Client.readContract.mockResolvedValue('0xPoolAddressV3');

    const pools = await orchestrator.getAllPools('0xWETH');

    // Should contain v3 pools, ignoring the v2 rate limit failures
    expect(pools.length).toBeGreaterThan(0);
    expect(pools.map(p => p.dex)).not.toContain('uniswap_v2');
    expect(pools.map(p => p.dex)).toContain('uniswap_v3');

    // Check that an error was logged for v2
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('orchestrator should handle RPC rate limits gracefully across real adapters during getAllRawData', async () => {
    const v2Adapter = new UniswapV2Adapter('http://localhost:8545');
    const v3Adapter = new UniswapV3Adapter('http://localhost:8545');

    // Mock the internal viem clients
    const mockV2Client = { readContract: vi.fn() };
    const mockV3Client = { readContract: vi.fn() };

    (v2Adapter as any).client = mockV2Client;
    (v3Adapter as any).client = mockV3Client;

    const orchestrator = new DEXOrchestrator([v2Adapter, v3Adapter]);

    // Suppress expected console errors
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // v2 fails with rate limit, v3 succeeds
    mockV2Client.readContract.mockRejectedValue(new Error('RPC rate limit exceeded (429)'));
    mockV3Client.readContract.mockResolvedValue([100n, 200n, 12345]); // v3 returns slot0/liquidity shape roughly (slot0 is mocked, liquidity we need to handle if both are called but we only mock one. Actually getRawData calls slot0 and liquidity. We will just mock readContract implementation.)

    mockV3Client.readContract.mockImplementation(async (args) => {
        if (args.functionName === 'slot0') return [1000n, 10, 1, 1, 1, 1, true];
        if (args.functionName === 'liquidity') return 5000n;
        return null;
    });

    const testPools = [
      { address: '0xPool1', dex: 'uniswap_v2', fee: 0.003 },
      { address: '0xPool2', dex: 'uniswap_v3', fee: 0.003 }
    ];

    const data = await orchestrator.getAllRawData(testPools);

    // Should contain v3 data, ignoring the v2 rate limit failures
    expect(data).toHaveLength(1);
    expect(data[0].pool.dex).toBe('uniswap_v3');
    expect(data[0].rawData.liquidity).toBe(5000n);

    // Check that an error was logged for v2
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
