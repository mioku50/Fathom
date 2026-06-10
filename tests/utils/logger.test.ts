import { describe, it, expect } from 'vitest';
import { formatLogMessage } from '../../src/utils/logger';

describe('Logging Helpers', () => {
    it('formats a basic message correctly', () => {
        const result = formatLogMessage('info', 'Hello world');
        expect(result).toBe('[INFO] Hello world');
    });

    it('formats a message with metadata correctly', () => {
        const result = formatLogMessage('error', 'Something failed', { code: 500 });
        expect(result).toBe('[ERROR] Something failed {"code":500}');
    });

    it('handles uppercase levels correctly', () => {
        const result = formatLogMessage('WARN', 'Watch out');
        expect(result).toBe('[WARN] Watch out');
    });

    it('handles empty message correctly', () => {
        const result = formatLogMessage('debug', '');
        expect(result).toBe('[DEBUG] ');
    });

    it('handles empty metadata correctly', () => {
        const result = formatLogMessage('info', 'Test', {});
        expect(result).toBe('[INFO] Test {}');
    });

    it('handles missing metadata explicitly undefined', () => {
        const result = formatLogMessage('info', 'Test', undefined);
        expect(result).toBe('[INFO] Test');
    });

    it('handles metadata with different data types', () => {
        const result = formatLogMessage('debug', 'Mixed meta', { num: 123, bool: true, str: 'text', nullVal: null });
        expect(result).toBe('[DEBUG] Mixed meta {"num":123,"bool":true,"str":"text","nullVal":null}');
    });

    it('handles nested objects in metadata', () => {
        const result = formatLogMessage('warn', 'Nested meta', { user: { id: 1, role: 'admin' } });
        expect(result).toBe('[WARN] Nested meta {"user":{"id":1,"role":"admin"}}');
    });

    it('handles arrays in metadata', () => {
        const result = formatLogMessage('info', 'Array meta', { tags: ['a', 'b', 'c'] });
        expect(result).toBe('[INFO] Array meta {"tags":["a","b","c"]}');
    });

    it('handles undefined properties in metadata', () => {
        const result = formatLogMessage('info', 'Undefined property', { prop1: 'value', prop2: undefined });
        expect(result).toBe('[INFO] Undefined property {"prop1":"value"}');
    });

    it('handles mixed case log levels', () => {
        const result = formatLogMessage('InFo', 'Mixed case', { data: 1 });
        expect(result).toBe('[INFO] Mixed case {"data":1}');
    });

    it('handles Object.create(null) metadata', () => {
        const meta = Object.create(null);
        meta.key = 'value';
        const result = formatLogMessage('info', 'Null prototype object', meta);
        expect(result).toBe('[INFO] Null prototype object {"key":"value"}');
    });

    it('handles functions in metadata (stringifies to undefined/omitted)', () => {
        const result = formatLogMessage('info', 'Function meta', { fn: () => {} });
        expect(result).toBe('[INFO] Function meta {}');
    });

    it('handles a message passed as a number (coercion behavior)', () => {
        // @ts-ignore: Intentionally testing JS behavior when non-strings are passed
        const result = formatLogMessage('warn', 404, { url: '/not-found' });
        expect(result).toBe('[WARN] 404 {"url":"/not-found"}');
    });

    it('handles Symbol in metadata (stringifies to undefined/omitted)', () => {
        const sym = Symbol('test');
        const result = formatLogMessage('debug', 'Symbol meta', { id: sym });
        expect(result).toBe('[DEBUG] Symbol meta {}');
    });

    it('handles circular references in metadata (should throw or fail if JSON.stringify throws)', () => {
        const circularMeta: any = { a: 1 };
        circularMeta.self = circularMeta;
        // JSON.stringify will throw TypeError: Converting circular structure to JSON
        expect(() => formatLogMessage('error', 'Circular', circularMeta)).toThrow();
    });

    it('handles BigInt in metadata (JSON.stringify throws unless replacer is used)', () => {
        // By default JSON.stringify throws on BigInt
        expect(() => formatLogMessage('info', 'BigInt meta', { val: 123n })).toThrow();
    });

    it('handles extremely long message string', () => {
        const longMsg = 'x'.repeat(10000);
        const result = formatLogMessage('info', longMsg);
        expect(result).toBe(`[INFO] ${longMsg}`);
    });

    it('handles null explicitly passed as metadata', () => {
        const result = formatLogMessage('info', 'Null meta', null as any);
        expect(result).toBe('[INFO] Null meta');
    });

    it('handles empty string log level', () => {
        const result = formatLogMessage('', 'Empty level');
        expect(result).toBe('[] Empty level');
    });

    it('handles multiline messages', () => {
        const result = formatLogMessage('error', 'Line 1\nLine 2\nLine 3');
        expect(result).toBe('[ERROR] Line 1\nLine 2\nLine 3');
    });

    it('handles log levels with leading and trailing whitespace', () => {
        const result = formatLogMessage('  info  ', 'Message');
        expect(result).toBe('[  INFO  ] Message');
    });

    it('handles JSON string within the message', () => {
        const result = formatLogMessage('debug', 'Payload: {"key": "value"}');
        expect(result).toBe('[DEBUG] Payload: {"key": "value"}');
    });

    it('handles metadata with keys containing special characters and spaces', () => {
        const result = formatLogMessage('warn', 'Special keys', { 'key with spaces': 1, '@special!': 'value' });
        expect(result).toBe('[WARN] Special keys {"key with spaces":1,"@special!":"value"}');
    });

    it('handles deeply nested complex metadata structures', () => {
        const complexMeta = {
            level1: {
                level2: {
                    level3: {
                        arr: [1, 2, { deepKey: 'deepValue' }]
                    }
                }
            }
        };
        const result = formatLogMessage('info', 'Deep nest', complexMeta);
        expect(result).toBe('[INFO] Deep nest {"level1":{"level2":{"level3":{"arr":[1,2,{"deepKey":"deepValue"}]}}}}');
    });

    it('handles empty message with metadata', () => {
        const result = formatLogMessage('info', '', { test: 123 });
        expect(result).toBe('[INFO]  {"test":123}');
    });

    it('handles custom object toString behavior in metadata', () => {
        const meta = {
            toString() { return 'custom-string'; },
            val: 1
        };
        const result = formatLogMessage('info', 'Custom toString', meta);
        expect(result).toBe('[INFO] Custom toString {"val":1}');
    });

    it('handles object with toJSON defined in metadata', () => {
        const meta = {
            toJSON() { return { custom: 'json-val' }; }
        };
        const result = formatLogMessage('debug', 'toJSON custom', meta);
        expect(result).toBe('[DEBUG] toJSON custom {"custom":"json-val"}');
    });

    it('handles undefined metadata when level is missing', () => {
        const result = formatLogMessage('', 'Missing level', undefined);
        expect(result).toBe('[] Missing level');
    });

    it('handles boolean message content (coercion behavior)', () => {
        // @ts-ignore: Intentionally testing JS behavior when non-strings are passed
        const result = formatLogMessage('info', true);
        expect(result).toBe('[INFO] true');
    });

    it('handles Array metadata with complex nested objects', () => {
        const complexArray = [
            { id: 1, nested: { prop: 'val1' } },
            { id: 2, arr: [3, 4] },
            null,
            "string"
        ];
        const result = formatLogMessage('debug', 'Complex Array', { data: complexArray });
        expect(result).toBe('[DEBUG] Complex Array {"data":[{"id":1,"nested":{"prop":"val1"}},{"id":2,"arr":[3,4]},null,"string"]}');
    });
});
