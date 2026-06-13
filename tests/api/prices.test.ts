
import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../../src/index';
import * as confidenceModule from '../../src/confidence';
import { DEXOrchestrator } from '../../src/orchestrator';

// Mock dependencies to avoid real network calls
vi.mock('../../src/orchestrator', () => {
  return {
    DEXOrchestrator: vi.fn().mockImplementation(() => ({
      getAllPools: vi.fn().mockResolvedValue([
        { dex: 'uniswap_v3', address: '0x123', fee: 3000 }
      ]),
      getAllRawData: vi.fn().mockResolvedValue([
        {
          pool: { dex: 'uniswap_v3', address: '0x123', fee: 3000 },
          rawData: { some: 'data' }
        }
      ])
    })),
    OrchestratorCacheAdapter: vi.fn()
  };
});

vi.mock('../../src/calculator', () => ({
  PriceCalculator: {
    calculatePoolPriceAndLiquidity: vi.fn().mockReturnValue({
      priceInQuote: 1.5,
      liquidityInQuote: 1000000
    })
  }
}));

vi.mock('../../src/confidence', () => ({
  calculateConfidence: vi.fn().mockReturnValue({
    confidence: 'high',
    label: 'Reliable',
    flags: []
  })
}));

describe('Prices API Endpoint (/v1/prices)', () => {
  
    let mockEnv: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockEnv = { ADMIN_AUTH_TOKEN: 'mock-token',
            FATHOM_KV: {
                get: vi.fn().mockResolvedValue(null),
                put: vi.fn().mockResolvedValue(undefined),
                delete: vi.fn().mockResolvedValue(undefined)
            },
            CACHE_DEFAULT_TTL_SECONDS: '60',
            BASE_RPC_URL: 'http://localhost:8545',
            X402_NETWORK: 'base',
            X402_RECIPIENT: '0x123',
            X402_FACILITATOR_URL: 'http://facilitator',
            PRICE_RPC_URL: 'http://localhost:8545',
            PRICE_CHAIN_ID: '8453'
        };
    });

    it('Should return 400 error when tokens parameter is missing', async () => {
        const req = new Request('http://localhost/v1/prices', {
          headers: { 'Authorization': 'Bearer mock-token' }
        });
        const res = await app.fetch(req, mockEnv, { waitUntil: vi.fn() } as any);

        expect(res.status).toBe(400);
        const data = await res.json() as any;
        expect(data.error).toBe('invalid_request');
        expect(data.message).toBe('tokens parameter is required');
    });

    it('Should return 400 error when tokens parameter is empty', async () => {
        const req = new Request('http://localhost/v1/prices?tokens=', {
          headers: { 'Authorization': 'Bearer mock-token' }
        });
        const res = await app.fetch(req, mockEnv, { waitUntil: vi.fn() } as any);

        expect(res.status).toBe(400);
        const data = await res.json() as any;
        expect(data.error).toBe('invalid_request');
        expect(data.message).toBe('tokens parameter is required');
    });

    it('Should return 400 error when token is an invalid Ethereum address format', async () => {
        // Based on validateAddressesMiddleware which intercepts and checks token format
        const req = new Request('http://localhost/v1/prices?tokens=not-an-address', {
          headers: { 'Authorization': 'Bearer mock-token' }
        });
        const res = await app.fetch(req, mockEnv, { waitUntil: vi.fn() } as any);

        expect(res.status).toBe(400);
        const data = await res.json() as any;
        expect(data.error).toBe('invalid_request');
    });

    it('Should return valid response structure for a valid token', async () => {
        const validToken = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Valid address format
        const req = new Request(`http://localhost/v1/prices?tokens=${validToken}`, {
          headers: { 'Authorization': 'Bearer mock-token' }
        });
        const res = await app.fetch(req, mockEnv, { waitUntil: vi.fn() } as any);

        expect(res.status).toBe(200);
        const data = await res.json() as any;

        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(1);

        const response = data[0];
        expect(response.token).toBe(validToken);
        expect(response.chain).toBe('base'); // Default
        expect(response.price_usd).toBe(1.5);
        expect(response.liquidity_usd).toBe(1000000);
        expect(response.confidence).toBe('high');
        expect(response.main_pool).toBeDefined();
        expect(response.main_pool.dex).toBe('uniswap_v3');
        expect(response.main_pool.address).toBe('0x123');
        expect(response.updated_at).toBeDefined();
    });

    it('Should limit to a maximum of 10 tokens', async () => {
        const tokens = Array.from({ length: 11 }, (_, i) => `0x${i.toString().padStart(40, '0')}`).join(',');
        const req = new Request(`http://localhost/v1/prices?tokens=${tokens}`, {
          headers: { 'Authorization': 'Bearer mock-token' }
        });
        const res = await app.fetch(req, mockEnv, { waitUntil: vi.fn() } as any);

        expect(res.status).toBe(400);
        const data = await res.json() as any;
        expect(data.error).toBe('invalid_request');
        expect(data.message).toBe('Maximum 10 tokens allowed per request');
    });

    it('Should correctly split and handle multiple tokens, skipping invalid ones', async () => {
        const validToken1 = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
        const validToken2 = '0x4200000000000000000000000000000000000006';

        // This will trigger validateAddressesMiddleware
        const req = new Request(`http://localhost/v1/prices?tokens=${validToken1},${validToken2},invalid-token`, {
          headers: { 'Authorization': 'Bearer mock-token' }
        });
        const res = await app.fetch(req, mockEnv, { waitUntil: vi.fn() } as any);

        // the middleware checks all tokens and returns 400 if ANY is invalid
        expect(res.status).toBe(400);
        const data = await res.json() as any;
        expect(data.error).toBe('invalid_request');
        expect(data.message).toMatch(/Invalid token address format/);
    });

    it('Should handle multiple valid tokens', async () => {
        const validToken1 = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
        const validToken2 = '0x4200000000000000000000000000000000000006';

        const req = new Request(`http://localhost/v1/prices?tokens=${validToken1},${validToken2}`, {
          headers: { 'Authorization': 'Bearer mock-token' }
        });
        const res = await app.fetch(req, mockEnv, { waitUntil: vi.fn() } as any);

        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(2);
        expect(data[0].token).toBe(validToken1);
        expect(data[1].token).toBe(validToken2);
    });

    it('Should not fail if main pool data is not found for a token', async () => {
        // Change calculator mock to return no liquidity
        // Instead of requireMock, override the mock just for this test
        const { PriceCalculator } = await import('../../src/calculator');
        (PriceCalculator.calculatePoolPriceAndLiquidity as any).mockReturnValueOnce({
          priceInQuote: 0,
          liquidityInQuote: 0
        });

        const validToken = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
        const req = new Request(`http://localhost/v1/prices?tokens=${validToken}`, {
          headers: { 'Authorization': 'Bearer mock-token' }
        });
        const res = await app.fetch(req, mockEnv, { waitUntil: vi.fn() } as any);

        // Since it continues when mainPoolData is not found, the results array will be empty
        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(0);
    });
});
