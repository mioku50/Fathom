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

  it('should handle empty strings for token and chain', () => {
    const response = generateDummyResponse('', '');
    expect(response.token).toBe('');
    expect(response.chain).toBe('');
  });

  it('should generate an updated_at as a valid ISO string', () => {
    const response = generateDummyResponse('AERO', 'base');
    const date = new Date(response.updated_at);
    expect(date.toISOString()).toBe(response.updated_at);
    expect(isNaN(date.getTime())).toBe(false);
  });

  it('should handle special characters in token and chain', () => {
    const response = generateDummyResponse('!@#$', '^*()');
    expect(response.token).toBe('!@#$');
    expect(response.chain).toBe('^*()');
  });

  it('should handle very long strings for token and chain', () => {
    const longToken = 'A'.repeat(1000);
    const longChain = 'B'.repeat(1000);
    const response = generateDummyResponse(longToken, longChain);
    expect(response.token).toBe(longToken);
    expect(response.chain).toBe(longChain);
  });

  it('should handle negative numbers correctly (if implemented in future updates)', () => {
    // This is just a test to check another condition (dummy logic right now).
    const response = generateDummyResponse('AERO', 'base');
    expect(response.price_usd).toBeGreaterThanOrEqual(0);
  });

  it('should generate updated_at matching current date logic', () => {
    const start = new Date();
    const response = generateDummyResponse('AERO', 'base');
    const end = new Date();
    const respDate = new Date(response.updated_at);

    expect(respDate.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(respDate.getTime()).toBeLessThanOrEqual(end.getTime());
  });

  it('should correctly format main_pool address', () => {
    const response = generateDummyResponse('AERO', 'base');
    expect(response.main_pool.address).toMatch(/^0x[a-fA-F0-9]+$/);
  });
});


import { parseTokensParam, formatPriceResponse } from '../src/utils';

describe('parseTokensParam', () => {
  it('should parse valid tokens', () => {
    const tokens = parseTokensParam('token1, token2, token3');
    expect(tokens).toEqual(['token1', 'token2', 'token3']);
  });
  it('should handle empty or missing tokens', () => {
    const tokens = parseTokensParam('');
    expect(tokens).toEqual([]);
  });
});

describe('formatPriceResponse', () => {
  it('should return formatted response', () => {
    const response = formatPriceResponse(
      'AERO',
      'base',
      1.0,
      100000,
      { dex: 'aerodrome', address: '0x123', fee: 0.003 },
      { confidence: 85, label: 'reliable', flags: [] }
    );
    expect(response.token).toBe('AERO');
    expect(response.chain).toBe('base');
    expect(response.price_usd).toBe(1.0);
    expect(response.liquidity_usd).toBe(100000);
    expect(response.confidence).toBe(85);
  });
});
