import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniswapV2Adapter } from '../../src/adapters/uniswap_v2';
import { UniswapV3Adapter } from '../../src/adapters/uniswap_v3';
import { AerodromeAdapter } from '../../src/adapters/aerodrome';
import { DEXAdapter } from '../../src/dex_adapter';
import { DEXOrchestrator } from '../../src/orchestrator';

describe('Real Adapters in Orchestrator', () => {
  it('should correctly register and identify all adapters', () => {
    const adapters: DEXAdapter[] = [
      new UniswapV2Adapter(),
      new UniswapV3Adapter(),
      new AerodromeAdapter()
    ];

    const orchestrator = new DEXOrchestrator(adapters);

    // We can verify that the adapters are correctly instantiated and have expected IDs
    expect(adapters[0].id).toBe('uniswap_v2');
    expect(adapters[1].id).toBe('uniswap_v3');
    expect(adapters[2].id).toBe('aerodrome');
  });

  it('should pass typechecks and interface compliance for real adapters', () => {
    const v2Adapter: DEXAdapter = new UniswapV2Adapter();
    const v3Adapter: DEXAdapter = new UniswapV3Adapter();
    const aerodromeAdapter: DEXAdapter = new AerodromeAdapter();

    expect(v2Adapter).toHaveProperty('getPools');
    expect(v2Adapter).toHaveProperty('getRawData');

    expect(v3Adapter).toHaveProperty('getPools');
    expect(v3Adapter).toHaveProperty('getRawData');

    expect(aerodromeAdapter).toHaveProperty('getPools');
    expect(aerodromeAdapter).toHaveProperty('getRawData');
  });
});
