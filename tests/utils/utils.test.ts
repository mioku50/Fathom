import { describe, it, expect } from 'vitest';
import { generateDummyResponse } from '../../src/utils';

describe('generateDummyResponse', () => {
    it('generates a valid PriceResponse object', () => {
        const response = generateDummyResponse('0x123', 'base');

        expect(response).toMatchObject({
            token: '0x123',
            chain: 'base',
            symbol: 'DUMMY',
            price_usd: 1.0,
            price_low: 0.95,
            price_high: 1.05,
            twap_5m: 1.01,
            confidence: 85,
            label: 'reliable',
            liquidity_usd: 100000,
            main_pool: {
                dex: 'aerodrome',
                address: '0x123',
                fee: 0.003
            },
            flags: []
        });
        expect(typeof response.updated_at).toBe('string');
        expect(!isNaN(Date.parse(response.updated_at))).toBe(true);
    });

    it('generates a valid PriceResponse with different token and chain', () => {
        const response = generateDummyResponse('0xABC', 'ethereum');
        expect(response.token).toBe('0xABC');
        expect(response.chain).toBe('ethereum');
        expect(response.symbol).toBe('DUMMY');
    });

    it('generates a valid PriceResponse with empty token and chain', () => {
        const response = generateDummyResponse('', '');
        expect(response.token).toBe('');
        expect(response.chain).toBe('');
    });
});
