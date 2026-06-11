import { describe, it, expect } from 'vitest';
import { validateEnv } from '../../src/utils/env';

describe('validateEnv', () => {
    it('should not throw if all required env vars are present', () => {
        const env = {
            BASE_RPC_URL: 'http://localhost:8545',
            X402_NETWORK: 'base',
            X402_RECIPIENT: '0x123',
            X402_FACILITATOR_URL: 'http://facilitator',
            CACHE_DEFAULT_TTL_SECONDS: '60'
        };
        expect(() => validateEnv(env)).not.toThrow();
    });

    it('should throw if env is undefined', () => {
        expect(() => validateEnv(undefined)).toThrow(/Missing required environment variables/);
    });

    it('should throw if one required variable is missing', () => {
        const env = {
            BASE_RPC_URL: 'http://localhost:8545',
            X402_NETWORK: 'base',
            X402_RECIPIENT: '0x123',
            X402_FACILITATOR_URL: 'http://facilitator',
        };
        expect(() => validateEnv(env)).toThrow(/CACHE_DEFAULT_TTL_SECONDS/);
    });

    it('should throw if a required variable is empty string', () => {
         const env = {
            BASE_RPC_URL: '',
            X402_NETWORK: 'base',
            X402_RECIPIENT: '0x123',
            X402_FACILITATOR_URL: 'http://facilitator',
            CACHE_DEFAULT_TTL_SECONDS: '60'
        };
        expect(() => validateEnv(env)).toThrow(/BASE_RPC_URL/);
    });

    it('should throw if multiple required variables are missing', () => {
         const env = {
            BASE_RPC_URL: 'http://localhost:8545',
            X402_NETWORK: 'base',
        };
        expect(() => validateEnv(env)).toThrow(/X402_RECIPIENT, X402_FACILITATOR_URL, CACHE_DEFAULT_TTL_SECONDS/);
    });
});
