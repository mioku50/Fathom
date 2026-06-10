import { describe, it, expect, vi } from 'vitest';
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

    it('generates a valid PriceResponse with special characters', () => {
        const response = generateDummyResponse('!@#$', 'chain-123_test');
        expect(response.token).toBe('!@#$');
        expect(response.chain).toBe('chain-123_test');
        expect(response.symbol).toBe('DUMMY');
    });

    it('generates a response with accurate updated_at timestamp', () => {
        vi.useFakeTimers();
        const fakeTime = new Date('2023-10-15T12:00:00.000Z');
        vi.setSystemTime(fakeTime);

        const response = generateDummyResponse('0x123', 'base');
        expect(response.updated_at).toBe(fakeTime.toISOString());

        vi.useRealTimers();
    });

    it('generates a valid PriceResponse with unicode characters in token and chain', () => {
        const response = generateDummyResponse('🦄', '✨chain');
        expect(response.token).toBe('🦄');
        expect(response.chain).toBe('✨chain');
    });

    it('generates a valid PriceResponse with very long strings', () => {
        const longToken = 'a'.repeat(1000);
        const longChain = 'b'.repeat(1000);
        const response = generateDummyResponse(longToken, longChain);
        expect(response.token).toBe(longToken);
        expect(response.chain).toBe(longChain);
    });

    it('generates a valid PriceResponse with whitespace strings', () => {
        const response = generateDummyResponse('  ', ' \n\t ');
        expect(response.token).toBe('  ');
        expect(response.chain).toBe(' \n\t ');
    });
});
