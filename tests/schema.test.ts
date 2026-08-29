import { describe, it, expect } from 'vitest';
import { isPoolData, isPriceResponse, PoolData, PriceResponse } from '../src/schema';

describe('schema validation', () => {
  describe('isPoolData', () => {
    it('should validate correct PoolData', () => {
      const validPool: PoolData = {
        dex: 'uniswap_v3',
        address: '0x123',
        liquidity_usd: 1000,
        price_usd: 1.5,
        fee: 3000
      };
      expect(isPoolData(validPool)).toBe(true);
    });

    it('should allow optional fields to be omitted', () => {
      const validPool: PoolData = {
        dex: 'aerodrome',
        address: '0x456'
      };
      expect(isPoolData(validPool)).toBe(true);
    });

    it('should reject empty strings for dex and address', () => {
      expect(isPoolData({ dex: '', address: '0x123' })).toBe(false);
      expect(isPoolData({ dex: 'uniswap_v3', address: '   ' })).toBe(false);
    });

    it('should reject invalid numeric values for liquidity_usd, price_usd, and fee', () => {
      expect(isPoolData({ dex: 'uniswap_v3', address: '0x123', liquidity_usd: -100 })).toBe(false);
      expect(isPoolData({ dex: 'uniswap_v3', address: '0x123', price_usd: NaN })).toBe(false);
      expect(isPoolData({ dex: 'uniswap_v3', address: '0x123', fee: Infinity })).toBe(false);
    });

    it('should reject invalid PoolData', () => {
      expect(isPoolData(null)).toBe(false);
      expect(isPoolData({})).toBe(false);
      expect(isPoolData({ dex: 'uniswap_v3' })).toBe(false);
      expect(isPoolData({ dex: 123, address: '0x123' })).toBe(false);
    });
  });

  describe('isPriceResponse', () => {
    it('should validate correct PriceResponse', () => {
      const validResponse: PriceResponse = {
        token: '0xabc',
        chain: 'base',
        symbol: 'MOCK',
        price_usd: 1.5,
        confidence: 0.9,
        label: 'high_confidence',
        liquidity_usd: 10000,
        source_count: 2,
        price_dispersion_bps: 120,
        twap: { price_usd: null, window_seconds: null, spot_deviation_bps: null },
        sell_quotes: [],
        depth_1pct_usd: null,
        depth_5pct_usd: null,
        measured_weight: 0.7,
        confidence_components: {
          liquidity: { score: 0.77, weight: 0.15, effective_weight: 0.25 },
          execution_quality: { score: 0.6, weight: 0.20, effective_weight: 0.333 },
          source_agreement: { score: 0.76, weight: 0.20, effective_weight: 0.286 },
          twap_deviation: { score: null, weight: 0.20, effective_weight: 0 },
          volatility: { score: 0.66, weight: 0.15, effective_weight: 0.214 },
          maturity: { score: null, weight: 0.10, effective_weight: 0 }
        },
        main_pool: {
          dex: 'uniswap_v3',
          address: '0x123'
        },
        flags: ['mock'],
        updated_at: new Date().toISOString()
      };
      expect(isPriceResponse(validResponse)).toBe(true);
    });

    it('should reject invalid PriceResponse', () => {
      expect(isPriceResponse(null)).toBe(false);
      expect(isPriceResponse({})).toBe(false);

      const missingFields = {
        token: '0xabc',
        chain: 'base'
      };
      expect(isPriceResponse(missingFields)).toBe(false);

      const invalidMainPool = {
        token: '0xabc',
        chain: 'base',
        symbol: 'MOCK',
        price_usd: 1.5,
        confidence: 0.9,
        label: 'high_confidence',
        liquidity_usd: 10000,
        source_count: 2,
        price_dispersion_bps: 120,
        twap: { price_usd: null, window_seconds: null, spot_deviation_bps: null },
        sell_quotes: [],
        depth_1pct_usd: null,
        depth_5pct_usd: null,
        measured_weight: 0.7,
        confidence_components: {
          liquidity: { score: 0.77, weight: 0.15, effective_weight: 0.25 },
          execution_quality: { score: 0.6, weight: 0.20, effective_weight: 0.333 },
          source_agreement: { score: 0.76, weight: 0.20, effective_weight: 0.286 },
          twap_deviation: { score: null, weight: 0.20, effective_weight: 0 },
          volatility: { score: 0.66, weight: 0.15, effective_weight: 0.214 },
          maturity: { score: null, weight: 0.10, effective_weight: 0 }
        },
        main_pool: {
          dex: 'uniswap_v3' // missing address
        },
        flags: ['mock'],
        updated_at: new Date().toISOString()
      };
      expect(isPriceResponse(invalidMainPool)).toBe(false);
    });
  });
});
