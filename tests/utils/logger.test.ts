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
});
