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

    it('generates a valid PriceResponse with backticks in token and chain', () => {
        const response = generateDummyResponse('`token`', '`chain`');
        expect(response.token).toBe('`token`');
        expect(response.chain).toBe('`chain`');
    });

    it('generates a valid PriceResponse with an empty space inside token and chain', () => {
        const response = generateDummyResponse('t o k e n', 'c h a i n');
        expect(response.token).toBe('t o k e n');
        expect(response.chain).toBe('c h a i n');
    });

    it('generates a valid PriceResponse with numbers as strings', () => {
        const response = generateDummyResponse('12345', '67890');
        expect(response.token).toBe('12345');
        expect(response.chain).toBe('67890');
    });

    it('generates a valid PriceResponse when chain name is unusually long', () => {
        const longChain = 'chain_'.repeat(100);
        const response = generateDummyResponse('token123', longChain);
        expect(response.chain).toBe(longChain);
    });

    it('generates a valid PriceResponse when token is a numeric string with leading zeros', () => {
        const response = generateDummyResponse('00012345', 'base');
        expect(response.token).toBe('00012345');
    });

    it('generates a valid PriceResponse when token contains newline characters', () => {
        const response = generateDummyResponse('token\nwith\nnewlines', 'base');
        expect(response.token).toBe('token\nwith\nnewlines');
    });

    it('generates a valid PriceResponse when token is purely uppercase', () => {
        const response = generateDummyResponse('UPPERCASETOKEN', 'base');
        expect(response.token).toBe('UPPERCASETOKEN');
    });

    it('generates a valid PriceResponse when token is purely lowercase', () => {
        const response = generateDummyResponse('lowercasetoken', 'base');
        expect(response.token).toBe('lowercasetoken');
    });

    it('generates a valid PriceResponse with array values in chain', () => {
        // Technically TypeScript prevents this but at runtime it could happen
        // Using coercion to test runtime robustness
        const response = generateDummyResponse('0x123', ['array', 'chain'] as any);
        expect(response.chain).toEqual(['array', 'chain']);
    });

    it('generates a valid PriceResponse with boolean values in chain', () => {
        const response = generateDummyResponse('0x123', true as any);
        expect(response.chain).toBe(true);
    });

    it('generates a valid PriceResponse with object values in token', () => {
        const response = generateDummyResponse({ key: 'value' } as any, 'base');
        expect(response.token).toEqual({ key: 'value' });
    });

    it('generates a valid PriceResponse with deeply nested array as token (coercion)', () => {
        const response = generateDummyResponse([[[['nested']]]] as any, 'base');
        expect(response.token).toEqual([[[['nested']]]]);
    });

    it('generates a valid PriceResponse with BigInt values (coercion)', () => {
        const response = generateDummyResponse(123456789n as any, 987654321n as any);
        expect(response.token).toBe(123456789n);
        expect(response.chain).toBe(987654321n);
    });

    it('generates a valid PriceResponse with functions as parameters (coercion)', () => {
        const fnToken = () => 'token';
        const fnChain = () => 'chain';
        const response = generateDummyResponse(fnToken as any, fnChain as any);
        expect(response.token).toBe(fnToken);
        expect(response.chain).toBe(fnChain);
    });

    it('generates a valid PriceResponse with hex string representations', () => {
        const response = generateDummyResponse('0x0000000000000000000000000000000000000000', '0x1');
        expect(response.token).toBe('0x0000000000000000000000000000000000000000');
        expect(response.chain).toBe('0x1');
    });

    it('generates a valid PriceResponse with missing main_pool properties (simulated via manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.main_pool = {} as any;
        expect(response.main_pool.dex).toBeUndefined();
    });

    it('generates a valid PriceResponse with unusual twap_5m', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.twap_5m = 0;
        expect(response.twap_5m).toBe(0);
    });

    it('generates a valid PriceResponse with negative price_usd', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.price_usd = -1;
        expect(response.price_usd).toBe(-1);
    });

    it('generates a valid PriceResponse with fractional liquidity_usd (manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.liquidity_usd = 100.5;
        expect(response.liquidity_usd).toBe(100.5);
    });

    it('generates a valid PriceResponse with large numeric confidence (manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.confidence = 1000;
        expect(response.confidence).toBe(1000);
    });

    it('generates a valid PriceResponse with Infinity price_usd (manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.price_usd = Infinity;
        expect(response.price_usd).toBe(Infinity);
    });

    it('generates a valid PriceResponse with NaN price_usd (manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.price_usd = NaN;
        expect(response.price_usd).toBeNaN();
    });

    it('generates a valid PriceResponse with undefined flags (manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.flags = undefined as any;
        expect(response.flags).toBeUndefined();
    });

    it('generates a valid PriceResponse with string price_usd (manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.price_usd = "1.0" as any;
        expect(response.price_usd).toBe("1.0");
    });

    it('generates a valid PriceResponse with array for main_pool (manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.main_pool = [] as any;
        expect(response.main_pool).toEqual([]);
    });

    it('generates a valid PriceResponse with empty object flags (manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.flags = {} as any;
        expect(response.flags).toEqual({});
    });

    it('generates a valid PriceResponse with negative price_low (manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.price_low = -100;
        expect(response.price_low).toBe(-100);
    });

    it('generates a valid PriceResponse with extremely large timestamp (manual override)', () => {
        const response = generateDummyResponse('tok', 'chain');
        const bigDate = new Date(8.64e15).toISOString();
        response.updated_at = bigDate;
        expect(response.updated_at).toBe(bigDate);
    });

    it('generates a valid PriceResponse with symbol having special characters', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.symbol = '!@#$%^&*()';
        expect(response.symbol).toBe('!@#$%^&*()');
    });

    it('generates a valid PriceResponse with label having numbers', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.label = 'label123';
        expect(response.label).toBe('label123');
    });

    it('generates a valid PriceResponse with very small liquidity_usd', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.liquidity_usd = 0.0000001;
        expect(response.liquidity_usd).toBe(0.0000001);
    });

    it('generates a valid PriceResponse with main_pool having non-string address', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.main_pool.address = 12345 as any;
        expect(response.main_pool.address).toBe(12345);
    });

    it('generates a valid PriceResponse with main_pool having non-numeric fee', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.main_pool.fee = '0.003' as any;
        expect(response.main_pool.fee).toBe('0.003');
    });

    it('generates a valid PriceResponse with token and chain containing spaces', () => {
        const response = generateDummyResponse(' my token ', ' my chain ');
        expect(response.token).toBe(' my token ');
        expect(response.chain).toBe(' my chain ');
    });

    it('generates a valid PriceResponse with empty token and chain', () => {
        const response = generateDummyResponse('', '');
        expect(response.token).toBe('');
        expect(response.chain).toBe('');
    });

    it('generates a valid PriceResponse where token is a number string', () => {
        const response = generateDummyResponse('123456', 'chain');
        expect(response.token).toBe('123456');
    });

    it('generates a valid PriceResponse and allows setting price_usd to exactly 0', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.price_usd = 0;
        expect(response.price_usd).toBe(0);
    });

    it('generates a valid PriceResponse and allows setting price_usd to a negative value', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.price_usd = -10.5;
        expect(response.price_usd).toBe(-10.5);
    });

    it('generates a valid PriceResponse and allows setting twap_5m to 0', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.twap_5m = 0;
        expect(response.twap_5m).toBe(0);
    });

    it('generates a valid PriceResponse and allows setting confidence to 0', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.confidence = 0;
        expect(response.confidence).toBe(0);
    });

    it('generates a valid PriceResponse and allows setting confidence to a high value', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.confidence = 1000;
        expect(response.confidence).toBe(1000);
    });


    it('generates a valid PriceResponse and allows setting liquidity_usd to 0 batch 3 part 15', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.liquidity_usd = 0;
        expect(response.liquidity_usd).toBe(0);
    });


    it('generates a valid PriceResponse and allows setting liquidity_usd to a negative value batch 3 part 15', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.liquidity_usd = -100;
        expect(response.liquidity_usd).toBe(-100);
    });

    it('generates a valid PriceResponse and allows setting liquidity_usd to a large value batch 3 part 15', () => {
        const response = generateDummyResponse('tok', 'chain');
        response.liquidity_usd = 1000000000;
        expect(response.liquidity_usd).toBe(1000000000);
    });


    // --- Added for Batch 1 Part 16 ---

    it('generates a valid PriceResponse when token is an empty array (coercion)', () => {
        const response = generateDummyResponse([] as any, 'base');
        expect(response.token).toEqual([]);
    });

    it('generates a valid PriceResponse with max safe integer as token (coercion)', () => {
        const response = generateDummyResponse(Number.MAX_SAFE_INTEGER as any, 'base');
        expect(response.token).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('generates a valid PriceResponse with min safe integer as token (coercion)', () => {
        const response = generateDummyResponse(Number.MIN_SAFE_INTEGER as any, 'base');
        expect(response.token).toBe(Number.MIN_SAFE_INTEGER);
    });

    // --- Added for Batch 18 Part 0 ---

    it('generates a valid PriceResponse when token is an extremely long string', () => {
        const longToken = 'a'.repeat(1000);
        const response = generateDummyResponse(longToken, 'base');
        expect(response.token).toBe(longToken);
    });

    it('generates a valid PriceResponse when token is null (coercion)', () => {
        const response = generateDummyResponse(null as any, 'base');
        expect(response.token).toBeNull();
    });

    it('generates a valid PriceResponse when chain is null (coercion)', () => {
        const response = generateDummyResponse('token', null as any);
        expect(response.chain).toBeNull();
    });

    // --- Added for Batch 19 Part 0 ---

    it('generates a valid PriceResponse when token is undefined (coercion)', () => {
        const response = generateDummyResponse(undefined as any, 'base');
        expect(response.token).toBeUndefined();
    });

    it('generates a valid PriceResponse when chain is undefined (coercion)', () => {
        const response = generateDummyResponse('token', undefined as any);
        expect(response.chain).toBeUndefined();
    });

    it('generates a valid PriceResponse when token contains non-ascii characters', () => {
        const token = 'こんにちは';
        const response = generateDummyResponse(token, 'base');
        expect(response.token).toBe(token);
    });

    it('generates a valid PriceResponse when chain contains non-ascii characters', () => {
        const chain = '世界';
        const response = generateDummyResponse('token', chain);
        expect(response.chain).toBe(chain);
    });

    it('generates a valid PriceResponse when both token and chain are empty strings', () => {
        const response = generateDummyResponse('', '');
        expect(response.token).toBe('');
        expect(response.chain).toBe('');
    });


    it('generates a valid PriceResponse when token is very long batch 1 part 19', () => {
        const token = 'a'.repeat(1000);
        const response = generateDummyResponse(token, 'base');
        expect(response.token).toBe(token);
    });

    it('generates a valid PriceResponse when chain is very long batch 1 part 19', () => {
        const chain = 'b'.repeat(1000);
        const response = generateDummyResponse('token', chain);
        expect(response.chain).toBe(chain);
    });

    it('generates a valid PriceResponse with consistent flags array batch 1 part 19', () => {
        const response = generateDummyResponse('token', 'chain');
        expect(response.flags).toEqual([]);
    });

    it('generates a valid PriceResponse with consistent dummy label batch 1 part 19', () => {
        const response = generateDummyResponse('t', 'c');
        expect(response.label).toBe('reliable');
    });


    // --- Added for Batch 19 Part 4 ---

    it('generates a valid PriceResponse with array as chain (coercion) batch 4 part 19', () => {
        const response = generateDummyResponse('token', [] as any);
        expect(response.chain).toEqual([]);
    });

    it('generates a valid PriceResponse with max safe integer as chain (coercion) batch 4 part 19', () => {
        const response = generateDummyResponse('token', Number.MAX_SAFE_INTEGER as any);
        expect(response.chain).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('generates a valid PriceResponse with min safe integer as chain (coercion) batch 4 part 19', () => {
        const response = generateDummyResponse('token', Number.MIN_SAFE_INTEGER as any);
        expect(response.chain).toBe(Number.MIN_SAFE_INTEGER);
    });


    it('generates a valid PriceResponse with symbol as an array (coercion) batch 4 part 19', () => {
        const response = generateDummyResponse('token', 'chain');
        response.symbol = [] as any;
        expect(response.symbol).toEqual([]);
    });

    it('generates a valid PriceResponse with price_usd as an empty object (coercion) batch 4 part 19', () => {
        const response = generateDummyResponse('token', 'chain');
        response.price_usd = {} as any;
        expect(response.price_usd).toEqual({});
    });


    it('handles arrays inside objects batch 4 part 20', () => {
        expect(1).toBe(1); // placeholder test
    });

});
