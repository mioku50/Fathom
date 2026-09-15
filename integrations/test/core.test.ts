import { describe, it, expect, vi } from 'vitest';
import { createFathomClient } from '../src/core/client.js';
import {
  FathomApiError,
  FathomNetworkError,
  FathomPaymentRequiredError,
  FathomServiceUnavailableError,
  FathomValidationError
} from '../src/core/errors.js';
import { FathomAssessmentSchema } from '../src/core/schemas.js';

const VALID_TOKEN = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';
const INVALID_TOKENS = [
  '0x123',
  'not-an-address',
  '940181a94A35A4569E4529A3CDfB74e38FD98631', // missing 0x
  '0x940181a94A35A4569E4529A3CDfB74e38FD9863Z', // non-hex
  ''
];

const mockAssessment = {
  token: VALID_TOKEN,
  chain: 'base',
  symbol: 'AERO',
  price_usd: 0.484,
  verdict: 'tradeable',
  reason: '$10,000 fills at 48 bps against a corroborated price.',
  size_usd: 10000,
  exit: {
    fillable: true,
    proceeds_usd: 9952,
    price_impact_bps: 48,
    execution_price_usd: 0.4818
  },
  price_trust: {
    confidence: 96,
    measured_weight: 0.75,
    sources: 6,
    dispersion_bps: 40,
    twap_deviation_bps: 0.9
  },
  concerns: [],
  unverified: [],
  updated_at: '2026-08-29T10:00:00.000Z'
};

const mockReducedAssessment = {
  token: VALID_TOKEN,
  chain: 'base',
  // No symbol and no price_usd
  verdict: 'unverified',
  reason: 'Fathom could not establish a price or exit quote. This does not mean the token has no pool or no liquidity.',
  size_usd: 10000,
  exit: {
    fillable: null,
    proceeds_usd: null,
    price_impact_bps: null,
    execution_price_usd: null
  },
  price_trust: {
    confidence: 0,
    measured_weight: 0,
    sources: 0,
    dispersion_bps: null,
    twap_deviation_bps: null
  },
  concerns: [],
  unverified: [
    'No supported price source was measured.',
    'Pool discovery is not proof that no other pool exists.'
  ],
  updated_at: '2026-08-29T10:00:00.000Z'
};

describe('Core Client: input validation', () => {
  const mockFetch = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(mockAssessment), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );
  const client = createFathomClient({ fetch: mockFetch });

  it('accepts a valid token address', async () => {
    const res = await client.assess({ token: VALID_TOKEN });
    expect(res.token).toBe(VALID_TOKEN);
  });

  it('rejects invalid token addresses', async () => {
    for (const badToken of INVALID_TOKENS) {
      await expect(client.assess({ token: badToken })).rejects.toThrow(FathomValidationError);
    }
  });

  it('accepts size boundaries: minimum 1 and maximum 10,000,000', async () => {
    await expect(client.assess({ token: VALID_TOKEN, sizeUsd: 1 })).resolves.toBeDefined();
    await expect(client.assess({ token: VALID_TOKEN, sizeUsd: 10_000_000 })).resolves.toBeDefined();
  });

  it('rejects size values outside boundaries', async () => {
    for (const badSize of [0, -1, 10_000_001, NaN, Infinity]) {
      await expect(client.assess({ token: VALID_TOKEN, sizeUsd: badSize })).rejects.toThrow(
        FathomValidationError
      );
    }
  });

  it('restricts chain to "base"', async () => {
    await expect(client.assess({ token: VALID_TOKEN, chain: 'base' })).resolves.toBeDefined();
    // @ts-expect-error test runtime rejection of invalid chain
    await expect(client.assess({ token: VALID_TOKEN, chain: 'ethereum' })).rejects.toThrow(
      FathomValidationError
    );
    // @ts-expect-error test runtime rejection of invalid chain
    await expect(client.assess({ token: VALID_TOKEN, chain: 'solana' })).rejects.toThrow(
      FathomValidationError
    );
  });
});

describe('Core Client: URL construction', () => {
  it('constructs the URL with token, size_usd, and chain', async () => {
    let requestedUrl = '';
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      requestedUrl = url;
      return Promise.resolve(
        new Response(JSON.stringify(mockAssessment), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    const client = createFathomClient({
      fetch: mockFetch,
      baseUrl: 'https://fathom-api.mioku-fathom.workers.dev'
    });

    await client.assess({ token: VALID_TOKEN, sizeUsd: 5000, chain: 'base' });

    const parsed = new URL(requestedUrl);
    expect(parsed.origin).toBe('https://fathom-api.mioku-fathom.workers.dev');
    expect(parsed.pathname).toBe('/v1/assess');
    expect(parsed.searchParams.get('token')).toBe(VALID_TOKEN);
    expect(parsed.searchParams.get('size_usd')).toBe('5000');
    expect(parsed.searchParams.get('chain')).toBe('base');
  });

  it('uses default size 10000 and chain base when omitted', async () => {
    let requestedUrl = '';
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      requestedUrl = url;
      return Promise.resolve(
        new Response(JSON.stringify(mockAssessment), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    const client = createFathomClient({ fetch: mockFetch });
    await client.assess({ token: VALID_TOKEN });

    const parsed = new URL(requestedUrl);
    expect(parsed.searchParams.get('size_usd')).toBe('10000');
    expect(parsed.searchParams.get('chain')).toBe('base');
  });
});

describe('Core Client: response parsing and Finding 1 reduced variant', () => {
  it('parses a full 200 assessment response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockAssessment), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const client = createFathomClient({ fetch: mockFetch });
    const result = await client.assess({ token: VALID_TOKEN });

    expect(result.symbol).toBe('AERO');
    expect(result.price_usd).toBe(0.484);
    expect(result.verdict).toBe('tradeable');
    expect(result.exit.fillable).toBe(true);
  });

  it('Finding 1: successfully parses reduced unverified variant with no symbol and no price_usd', async () => {
    // FathomAssessmentSchema MUST accept body without symbol and without price_usd
    const parseResult = FathomAssessmentSchema.safeParse(mockReducedAssessment);
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.symbol).toBeUndefined();
      expect(parseResult.data.price_usd).toBeUndefined();
      expect(parseResult.data.verdict).toBe('unverified');
    }

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockReducedAssessment), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const client = createFathomClient({ fetch: mockFetch });
    const result = await client.assess({ token: VALID_TOKEN });

    expect(result.symbol).toBeUndefined();
    expect(result.price_usd).toBeUndefined();
    expect(result.verdict).toBe('unverified');
    expect(result.exit.fillable).toBeNull();
  });

  it('throws FathomValidationError on invalid response body', async () => {
    const invalidBodies = [
      { token: VALID_TOKEN }, // missing verdict, exit, etc.
      { ...mockAssessment, verdict: 'unknown_verdict' }, // invalid verdict enum
      { ...mockAssessment, size_usd: 'not-a-number' }, // wrong type
      null,
      'not-json'
    ];

    for (const body of invalidBodies) {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
      const client = createFathomClient({ fetch: mockFetch });
      await expect(client.assess({ token: VALID_TOKEN })).rejects.toThrow(FathomValidationError);
    }
  });
});

describe('Core Client: HTTP error conditions', () => {
  it('throws FathomPaymentRequiredError on 402 Payment Required', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'payment_required' }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const client = createFathomClient({ fetch: mockFetch });
    await expect(client.assess({ token: VALID_TOKEN })).rejects.toThrow(
      FathomPaymentRequiredError
    );
  });

  it('throws FathomServiceUnavailableError on 503 error response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'rpc_error', message: 'could not read pools' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const client = createFathomClient({ fetch: mockFetch });
    await expect(client.assess({ token: VALID_TOKEN })).rejects.toThrow(
      FathomServiceUnavailableError
    );
  });

  it('returns unverified assessment if 503 carries unverifiedAssessment payload', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockReducedAssessment), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const client = createFathomClient({ fetch: mockFetch });
    const result = await client.assess({ token: VALID_TOKEN });
    expect(result.verdict).toBe('unverified');
    expect(result.symbol).toBeUndefined();
  });

  it('throws FathomApiError on unexpected non-200 HTTP status', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'internal_error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const client = createFathomClient({ fetch: mockFetch });
    await expect(client.assess({ token: VALID_TOKEN })).rejects.toThrow(FathomApiError);
  });

  it('throws FathomNetworkError when fetch rejects', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const client = createFathomClient({ fetch: mockFetch });
    await expect(client.assess({ token: VALID_TOKEN })).rejects.toThrow(FathomNetworkError);
  });
});
