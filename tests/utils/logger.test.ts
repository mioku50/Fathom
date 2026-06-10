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
});
