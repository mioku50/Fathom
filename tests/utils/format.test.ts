import { describe, it, expect } from 'vitest';
import { formatCurrency, formatAddress } from '../../src/utils/format';

describe('format utility functions', () => {
    describe('formatCurrency', () => {
        it('formats a number as USD currency', () => {
            expect(formatCurrency(1234.56)).toBe('$1,234.56');
        });
        it('handles zero correctly', () => {
            expect(formatCurrency(0)).toBe('$0.00');
        });
    });

    describe('formatAddress', () => {
        it('shortens a valid Ethereum address', () => {
            expect(formatAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234...5678');
        });
        it('returns the original string if it is too short', () => {
            expect(formatAddress('0x123')).toBe('0x123');
        });
        it('handles empty string', () => {
            expect(formatAddress('')).toBe('');
        });
    });
});
