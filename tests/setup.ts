import { vi, beforeAll, afterAll } from 'vitest';

const originalConsoleError = console.error;

beforeAll(() => {
  console.error = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Error checking pool for')) {
      return;
    }
    originalConsoleError(...args);
  };
  
  global.fetch = vi.fn().mockImplementation((url: any, options: any) => {
    const urlStr = url?.toString() || '';
    if (urlStr.includes('supported') || urlStr.includes('kinds')) {
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', asset: 'usdc' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return Promise.resolve(new Response(JSON.stringify({
      success: true,
      transaction: '0x123',
      network: 'eip155:84532',
      amount: '10000',
      payer: '0xabc',
      errorReason: null,
      errorMessage: null,
      extensions: {}
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  })
});

afterAll(() => {
  console.error = originalConsoleError;
});
