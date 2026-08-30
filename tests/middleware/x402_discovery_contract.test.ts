import { describe, it, expect, vi, beforeEach } from 'vitest';
import { declareDiscoveryExtension, validateDiscoveryExtension } from '@x402/extensions';
import { priceInputSchema, priceOutputSchema } from '../../src/schemas/x402DiscoverySchemas';

/** Pin the official Bazaar wire format that the CDP/Agentic Market validator reads. */
const TEST_ENV = {
  FATHOM_X402_FACILITATOR_URL: 'http://mock',
  X402_NETWORK: 'base-sepolia',
  X402_PRICE_USDC: '0.001',
  X402_PRICE_BATCH_USDC: '0.003',
  FATHOM_X402_RECIPIENT: '0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909',
  BASE_BUILDER_CODE: 'bc_tzj2linw',
  BASE_RPC_URL: 'http://localhost:8545',
  CACHE_DEFAULT_TTL_SECONDS: '60',
  PRICE_RPC_URL: 'http://localhost:8545',
  PRICE_CHAIN_ID: '8453'
} as any;

describe('x402 discovery extension contract', () => {
  beforeEach(() => {
    // Only /supported is needed to build the challenge; never mock /verify.
    global.fetch = vi.fn().mockImplementation((url: any) =>
      url.toString().includes('supported')
        ? Promise.resolve(new Response(JSON.stringify({
            success: true,
            kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', asset: 'usdc' }]
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        : Promise.resolve(new Response(null, { status: 404 }))
    );
  });

  const official: any = declareDiscoveryExtension({
    method: 'GET',
    input: { token: '0x940181a94A35A4569E4529A3CDfB74e38FD98631' },
    inputSchema: priceInputSchema,
    output: {
      example: { token: '0xabc', chain: 'base', status: 'ok' },
      schema: priceOutputSchema
    }
  } as any);

  it('uses the SDK-native output wrapper and validates its example', () => {
    const schema = official.bazaar?.schema;

    expect(validateDiscoveryExtension(official.bazaar)).toEqual({ valid: true });
    expect(schema?.required).toEqual(['input']);
    expect(Object.keys(schema?.properties?.output?.properties ?? {})).toEqual(['type', 'example']);
    expect(schema?.properties?.output?.properties?.example).toEqual(priceOutputSchema);
    expect(schema?.properties?.input?.properties?.method?.enum).toContain('HEAD');
  });

  it('serves a validator-compatible discovery extension, GET only', async () => {
    const { default: app } = await import('../../src/index');

    const res = await app.fetch(
      new Request('http://localhost/v1/price?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631'),
      TEST_ENV,
      { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as any
    );

    expect(res.status).toBe(402);

    const header = res.headers.get('Payment-Required');
    expect(header).toBeTruthy();
    const challenge = JSON.parse(Buffer.from(header!, 'base64').toString('utf8'));

    const bazaar = challenge.extensions?.bazaar;
    expect(bazaar).toBeTruthy();
    expect(validateDiscoveryExtension(bazaar)).toEqual({ valid: true });
    expect(bazaar.schema.required).toEqual(['input']);
    expect(bazaar.schema.properties.input.properties.method.enum).toEqual(['GET']);

    // The response schema belongs under output.example in the Bazaar protocol.
    const output = bazaar.schema.properties.output.properties.example;
    expect(output.properties.price_usd).toEqual({ type: 'number' });
    expect(output.properties.confidence.maximum).toBe(100);
    expect(output.properties.source_count).toBeTruthy();
    expect(output.properties.confidence_components).toBeTruthy();
    expect(output).toEqual(priceOutputSchema);

    // fields removed in step 0 must not reappear through the SDK
    expect(output.properties.twap_5m).toBeUndefined();
    expect(output.properties.price_low).toBeUndefined();
    expect(output.properties.price_high).toBeUndefined();
  });

  it('carries the Base Builder Code in the challenge', async () => {
    const { default: app } = await import('../../src/index');

    const res = await app.fetch(
      new Request('http://localhost/v1/prices?tokens=0x940181a94A35A4569E4529A3CDfB74e38FD98631'),
      TEST_ENV,
      { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as any
    );

    expect(res.status).toBe(402);
    const challenge = JSON.parse(
      Buffer.from(res.headers.get('Payment-Required')!, 'base64').toString('utf8')
    );

    expect(challenge.extensions['builder-code'].info.a).toBe('bc_tzj2linw');
    // batch route is priced separately from the single-token route
    expect(challenge.accepts[0].amount).toBe('3000');
    expect(challenge.accepts[0].network).toBe('eip155:84532');
  });
});
