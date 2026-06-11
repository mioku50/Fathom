import { describe, it, expect } from 'vitest';
import { generateDummyResponse } from '../src/utils';

describe('generateDummyResponse', () => {
  it('should generate a dummy response with the given token and chain', () => {
    const response = generateDummyResponse('AERO', 'base');

    expect(response.token).toBe('AERO');
    expect(response.chain).toBe('base');
    expect(response.symbol).toBe('DUMMY');
    expect(response.price_usd).toBe(1.0);
    expect(response.price_low).toBe(0.95);
    expect(response.price_high).toBe(1.05);
    expect(response.twap_5m).toBe(1.01);
    expect(response.confidence).toBe(85);
    expect(response.label).toBe('reliable');
    expect(response.liquidity_usd).toBe(100000);
    expect(response.main_pool).toEqual({
      dex: 'aerodrome',
      address: '0x123',
      fee: 0.003
    });
    expect(response.flags).toEqual([]);
    expect(response.updated_at).toBeDefined();
  });
});
