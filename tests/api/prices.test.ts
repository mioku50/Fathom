
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
    let mockEnv;

    beforeEach(() => {
        vi.clearAllMocks();

        mockEnv = {
            FATHOM_KV: {
                get: vi.fn().mockResolvedValue(null),
                put: vi.fn().mockResolvedValue(undefined),
                delete: vi.fn().mockResolvedValue(undefined)
            },
            CACHE_DEFAULT_TTL_SECONDS: '60',
            BASE_RPC_URL: 'http://localhost:8545',
            X402_NETWORK: 'base',
            X402_RECIPIENT: '0x123',
            X402_FACILITATOR_URL: 'http://facilitator'
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
});
