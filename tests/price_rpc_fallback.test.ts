import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PriceRpcClient } from '../src/utils/price_rpc';
import * as http from 'http';

describe('PriceRpcClient Fallback', () => {
  let server: http.Server;
  let requestCounts = {
    primary: 0,
    fallback1: 0,
    fallback2: 0
  };
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      // Return CORS headers just in case
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        if (req.url?.includes('primary')) {
          requestCounts.primary++;
          res.writeHead(429);
          res.end(JSON.stringify({ error: { code: 429, message: 'Too Many Requests' } }));
        } else if (req.url?.includes('fallback1')) {
          requestCounts.fallback1++;
          res.writeHead(500);
          res.end(JSON.stringify({ error: { code: 500, message: 'Internal Server Error' } }));
        } else if (req.url?.includes('fallback2')) {
          requestCounts.fallback2++;
          // We can return a fake JSON RPC success here for getBlockNumber
          res.writeHead(200);
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  it('cycles through fallbacks when hitting 429 and 500', async () => {
    const primary = `http://localhost:${port}/primary`;
    const fallbacks = `http://localhost:${port}/fallback1, http://localhost:${port}/fallback2`;
    
    const client = new PriceRpcClient(primary, fallbacks);
    
    // Call something simple that viem will route through the transport
    try {
      await client.readContract({
        address: '0x0000000000000000000000000000000000000000',
        abi: [{ type: 'function', name: 'foo', inputs: [], outputs: [] }],
        functionName: 'foo'
      });
    } catch {
      // It might throw a contract error because of fake JSON response, that's fine
    }

    expect(requestCounts.primary).toBeGreaterThan(0);
    expect(requestCounts.fallback1).toBeGreaterThan(0);
    expect(requestCounts.fallback2).toBeGreaterThan(0);
  });
  
  it('throws a safe 503-style error if ALL fail', async () => {
    const primary = `http://localhost:${port}/primary`;
    const fallbacks = `http://localhost:${port}/fallback1`;
    
    const client = new PriceRpcClient(primary, fallbacks);
    
    await expect(client.readContract({
      address: '0x0000000000000000000000000000000000000000',
      abi: [{ type: 'function', name: 'foo', inputs: [], outputs: [] }],
      functionName: 'foo'
    })).rejects.toThrow(/\[REDACTED_URL\]/);
  });
});

describe('PriceRpcClient decimals caching', () => {
  it('reads decimals once per token across a request', async () => {
    const client = new PriceRpcClient('http://primary.example');
    const readContract = vi.fn().mockResolvedValue(9);
    (client as any).client = { readContract };

    const token = '0x1111111111111111111111111111111111111111';
    const results = await Promise.all([
      client.getTokenDecimals(token),
      client.getTokenDecimals(token),
      client.getTokenDecimals(token)
    ]);

    expect(results).toEqual([9, 9, 9]);
    expect(readContract).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure, so a transient RPC error is retryable', async () => {
    const client = new PriceRpcClient('http://primary.example');
    const readContract = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(18);
    (client as any).client = { readContract };

    const token = '0x2222222222222222222222222222222222222222';

    await expect(client.getTokenDecimals(token)).rejects.toMatchObject({ code: 'unknown_decimals' });
    await expect(client.getTokenDecimals(token)).resolves.toBe(18);
    expect(readContract).toHaveBeenCalledTimes(2);
  });

  it('answers canonical tokens without touching the network', async () => {
    const client = new PriceRpcClient('http://primary.example');
    const readContract = vi.fn();
    (client as any).client = { readContract };

    await expect(client.getTokenDecimals('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).resolves.toBe(6);
    await expect(client.getTokenDecimals('0x4200000000000000000000000000000000000006')).resolves.toBe(18);
    expect(readContract).not.toHaveBeenCalled();
  });
});
