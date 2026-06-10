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

    it('generates a PriceResponse where pools is undefined', () => {
        const response = generateDummyResponse('0x123', 'base');
        expect(response.pools).toBeUndefined();
    });

    it('generates a PriceResponse where confidence is exactly 85', () => {
        const response = generateDummyResponse('0x123', 'base');
        expect(response.confidence).toBe(85);
    });

    it('generates a PriceResponse with specific main_pool structure', () => {
        const response = generateDummyResponse('0x123', 'base');
        expect(response.main_pool).toBeDefined();
        expect(response.main_pool.dex).toBe('aerodrome');
        expect(response.main_pool.address).toBe('0x123');
        expect(response.main_pool.fee).toBe(0.003);
    });

    it('generates a PriceResponse with an empty flags array', () => {
        const response = generateDummyResponse('0x123', 'base');
        expect(Array.isArray(response.flags)).toBe(true);
        expect(response.flags.length).toBe(0);
    });

    it('generates a PriceResponse with a 1-character token and chain', () => {
        const response = generateDummyResponse('a', 'b');
        expect(response.token).toBe('a');
        expect(response.chain).toBe('b');
    });

    it('generates a PriceResponse with extremely long token string', () => {
        const longToken = 'x'.repeat(5000);
        const response = generateDummyResponse(longToken, 'base');
        expect(response.token).toBe(longToken);
        expect(response.chain).toBe('base');
    });

    it('generates a PriceResponse with a null-byte in strings', () => {
        const response = generateDummyResponse('a\0b', 'c\0d');
        expect(response.token).toBe('a\0b');
        expect(response.chain).toBe('c\0d');
    });

    it('generates a PriceResponse with html/script injection strings', () => {
        const response = generateDummyResponse('<script>alert(1)</script>', '"><img src=x onerror=alert(1)>');
        expect(response.token).toBe('<script>alert(1)</script>');
        expect(response.chain).toBe('"><img src=x onerror=alert(1)>');
    });

    it('generates a PriceResponse with undefined-like string values', () => {
        const response = generateDummyResponse('undefined', 'null');
        expect(response.token).toBe('undefined');
        expect(response.chain).toBe('null');
    });

    it('generates a response with correct property types', () => {
        const response = generateDummyResponse('0x123', 'base');
        expect(typeof response.token).toBe('string');
        expect(typeof response.chain).toBe('string');
        expect(typeof response.symbol).toBe('string');
        expect(typeof response.price_usd).toBe('number');
        expect(typeof response.price_low).toBe('number');
        expect(typeof response.price_high).toBe('number');
        expect(typeof response.twap_5m).toBe('number');
        expect(typeof response.confidence).toBe('number');
        expect(typeof response.label).toBe('string');
        expect(typeof response.liquidity_usd).toBe('number');
        expect(typeof response.main_pool).toBe('object');
        expect(Array.isArray(response.flags)).toBe(true);
        expect(typeof response.updated_at).toBe('string');
    });

    it('generates consistent responses across multiple calls', () => {
        const response1 = generateDummyResponse('0x123', 'base');
        const response2 = generateDummyResponse('0x123', 'base');

        // They should be identical except potentially updated_at if called in different milliseconds,
        // but typically vitest runs them fast enough or we just ignore updated_at
        const r1 = { ...response1, updated_at: '' };
        const r2 = { ...response2, updated_at: '' };

        expect(r1).toEqual(r2);
    });

    it('generates a valid PriceResponse with complex emojis for token and chain', () => {
        const response = generateDummyResponse('👨‍👩‍👧‍👦', '🏳️‍🌈');
        expect(response.token).toBe('👨‍👩‍👧‍👦');
        expect(response.chain).toBe('🏳️‍🌈');
    });

    it('generates an updated_at string strictly matching ISO 8601 format', () => {
        const response = generateDummyResponse('0x123', 'base');
        const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
        expect(iso8601Regex.test(response.updated_at)).toBe(true);
    });

    it('generates a valid PriceResponse when passing very short symbol names (token/chain)', () => {
        const response = generateDummyResponse('t', 'c');
        expect(response.token).toBe('t');
        expect(response.chain).toBe('c');
    });

    it('generates a valid PriceResponse where token and chain are the same string', () => {
        const response = generateDummyResponse('same-string', 'same-string');
        expect(response.token).toBe('same-string');
        expect(response.chain).toBe('same-string');
    });

    it('ensures the flags array remains mutable if modified later', () => {
        const response = generateDummyResponse('0x123', 'base');
        expect(response.flags).toEqual([]);

        response.flags.push('test-flag');
        expect(response.flags).toEqual(['test-flag']);
    });
});
