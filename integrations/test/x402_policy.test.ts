import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createFathomX402Fetch,
  CANONICAL_FATHOM_PAYMENT_TERMS,
  EvmSigner
} from '../src/x402/transport.js';
import { FathomPaymentPolicyError } from '../src/core/errors.js';

const CANONICAL_URL = 'https://fathom-api.mioku-fathom.workers.dev/v1/assess';

function createChallenge(overrides: Partial<any> = {}) {
  const requirement = {
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '1000',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    payTo: '0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909',
    maxTimeoutSeconds: 300,
    extra: {
      name: 'USD Coin',
      version: '2'
    },
    ...(overrides.requirement || {})
  };

  const payload = {
    x402Version: 2,
    resource: {
      url: overrides.url ?? CANONICAL_URL
    },
    accepts: [requirement],
    extensions: {
      'builder-code': {
        info: {
          a: 'bc_tzj2linw'
        }
      },
      ...(overrides.extensions || {})
    }
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

describe('x402 Transport: Fail-Closed Policy Enforcement', () => {
  let signTypedDataCount = 0;
  let lastSignedTypedData: any = null;

  const mockSigner: EvmSigner = {
    address: '0x1234567890123456789012345678901234567890',
    signTypedData: async params => {
      signTypedDataCount++;
      lastSignedTypedData = params;
      return ('0x' + '1'.repeat(130)) as `0x${string}`;
    }
  };

  beforeEach(() => {
    signTypedDataCount = 0;
    lastSignedTypedData = null;
  });

  it('ALLOW: signs and completes payment when all 6 dimensions match canonical terms', async () => {
    let fetchCount = 0;
    let paymentSignatureHeader: string | null = null;

    const mockFetch = vi.fn().mockImplementation((req: Request) => {
      fetchCount++;
      if (fetchCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 402,
            headers: {
              'PAYMENT-REQUIRED': createChallenge()
            }
          })
        );
      }
      paymentSignatureHeader = req.headers.get('PAYMENT-SIGNATURE');
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
    const response = await paidFetch(CANONICAL_URL);

    expect(response.status).toBe(200);
    expect(signTypedDataCount).toBe(1);
    expect(lastSignedTypedData).toBeDefined();

    // Finding 3: builder-code attribution must survive into the paid signature payload
    expect(paymentSignatureHeader).toBeDefined();
    const decodedPayload = JSON.parse(
      Buffer.from(paymentSignatureHeader!, 'base64').toString('utf8')
    );
    expect(decodedPayload.extensions?.['builder-code']?.info?.a).toBe('bc_tzj2linw');
  });

  it('ALLOW: accepts amount less than 1000 atomic units (ceiling test)', async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCount++;
      if (fetchCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 402,
            headers: {
              'PAYMENT-REQUIRED': createChallenge({ requirement: { amount: '500' } })
            }
          })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
    await paidFetch(CANONICAL_URL);
    expect(signTypedDataCount).toBe(1);
  });

  it('BLOCK: wrong amount (> 1000 atomic ceiling) - signTypedData must be called 0 times', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': createChallenge({ requirement: { amount: '1001' } })
        }
      })
    );

    const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
    await expect(paidFetch(CANONICAL_URL)).rejects.toThrow();
    expect(signTypedDataCount).toBe(0);
  });

  it('BLOCK: wrong network (!= eip155:8453) - signTypedData must be called 0 times', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': createChallenge({ requirement: { network: 'eip155:1' } })
        }
      })
    );

    const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
    await expect(paidFetch(CANONICAL_URL)).rejects.toThrow();
    expect(signTypedDataCount).toBe(0);
  });

  it('BLOCK: wrong asset (!= Base USDC) - signTypedData must be called 0 times', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': createChallenge({
            requirement: { asset: '0x0000000000000000000000000000000000000000' }
          })
        }
      })
    );

    const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
    await expect(paidFetch(CANONICAL_URL)).rejects.toThrow();
    expect(signTypedDataCount).toBe(0);
  });

  it('BLOCK: wrong payTo recipient - signTypedData must be called 0 times', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': createChallenge({
            requirement: { payTo: '0x1111111111111111111111111111111111111111' }
          })
        }
      })
    );

    const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
    await expect(paidFetch(CANONICAL_URL)).rejects.toThrow();
    expect(signTypedDataCount).toBe(0);
  });

  it('BLOCK: wrong host - signTypedData must be called 0 times', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': createChallenge({ url: 'https://evil.com/v1/assess' })
        }
      })
    );

    const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
    await expect(paidFetch('https://evil.com/v1/assess')).rejects.toThrow();
    expect(signTypedDataCount).toBe(0);
  });

  it('BLOCK: wrong path - signTypedData must be called 0 times', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': createChallenge({
            url: 'https://fathom-api.mioku-fathom.workers.dev/v1/price'
          })
        }
      })
    );

    const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
    await expect(paidFetch('https://fathom-api.mioku-fathom.workers.dev/v1/price')).rejects.toThrow();
    expect(signTypedDataCount).toBe(0);
  });

  it('BLOCK: wrong scheme (!= exact) - signTypedData must be called 0 times', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': createChallenge({ requirement: { scheme: 'upto' } })
        }
      })
    );

    const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
    await expect(paidFetch(CANONICAL_URL)).rejects.toThrow();
    expect(signTypedDataCount).toBe(0);
  });

  // A malicious server can advertise Fathom's canonical resource and canonical
  // terms while being the one that receives the signed payment. Validating only
  // the challenge authorises exactly that. Every case below keeps the advertised
  // resource canonical and moves ONLY the request target.
  describe('BLOCK: split-target challenge (request URL != advertised resource)', () => {
    async function attempt(requestUrl: string) {
      let fetchCount = 0;
      let retriedTo: string | null = null;

      const mockFetch = vi.fn().mockImplementation((req: any) => {
        fetchCount++;
        const url = typeof req === 'string' ? req : req.url;
        if (fetchCount === 1) {
          return Promise.resolve(
            new Response(null, {
              status: 402,
              headers: { 'PAYMENT-REQUIRED': createChallenge() }
            })
          );
        }
        retriedTo = url;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
      const error = await paidFetch(requestUrl).then(
        () => null,
        (e: unknown) => e
      );
      return { error, fetchCount, retriedTo };
    }

    it('attacker host - signTypedData must be called 0 times and nothing is sent', async () => {
      const { error, fetchCount, retriedTo } = await attempt('https://evil.example/v1/assess');

      expect(error).toBeInstanceOf(FathomPaymentPolicyError);
      expect((error as Error).message).toMatch(/evil\.example/);
      expect(signTypedDataCount).toBe(0);
      expect(retriedTo).toBeNull();
      // Refused before the unpaid probe, so not even the first request is sent.
      expect(fetchCount).toBe(0);
    });

    it('canonical host on a non-default port - signTypedData must be called 0 times', async () => {
      const { error, retriedTo } = await attempt(
        'https://fathom-api.mioku-fathom.workers.dev:8443/v1/assess'
      );

      expect(error).toBeInstanceOf(FathomPaymentPolicyError);
      expect((error as Error).message).toMatch(/:8443/);
      expect(signTypedDataCount).toBe(0);
      expect(retriedTo).toBeNull();
    });

    it('subdomain of the canonical host - signTypedData must be called 0 times', async () => {
      const { error, retriedTo } = await attempt(
        'https://fathom-api.mioku-fathom.workers.dev.evil.example/v1/assess'
      );

      expect(error).toBeInstanceOf(FathomPaymentPolicyError);
      expect(signTypedDataCount).toBe(0);
      expect(retriedTo).toBeNull();
    });

    it('plaintext http - signTypedData must be called 0 times', async () => {
      const { error, retriedTo } = await attempt(
        'http://fathom-api.mioku-fathom.workers.dev/v1/assess'
      );

      expect(error).toBeInstanceOf(FathomPaymentPolicyError);
      expect((error as Error).message).toMatch(/https is required/);
      expect(signTypedDataCount).toBe(0);
      expect(retriedTo).toBeNull();
    });

    it('canonical host, non-paid path - signTypedData must be called 0 times', async () => {
      const { error, retriedTo } = await attempt(
        'https://fathom-api.mioku-fathom.workers.dev/v1/price'
      );

      expect(error).toBeInstanceOf(FathomPaymentPolicyError);
      expect(signTypedDataCount).toBe(0);
      expect(retriedTo).toBeNull();
    });
  });

  it('ALLOW: query parameters are preserved and do not defeat the target check', async () => {
    const withQuery =
      CANONICAL_URL + '?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631&size_usd=10000';

    let fetchCount = 0;
    let paidUrl: string | null = null;

    const mockFetch = vi.fn().mockImplementation((req: any) => {
      fetchCount++;
      if (fetchCount === 1) {
        return Promise.resolve(
          new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': createChallenge() } })
        );
      }
      paidUrl = typeof req === 'string' ? req : req.url;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const paidFetch = createFathomX402Fetch({ signer: mockSigner, fetch: mockFetch });
    const res = await paidFetch(withQuery);

    expect(res.status).toBe(200);
    expect(signTypedDataCount).toBe(1);
    // The canonical challenge resource is query-free; the real request is not.
    expect(paidUrl).toBe(withQuery);
  });

  describe('the policy is not caller-configurable', () => {
    it('rejects an attempt to raise the spend ceiling', () => {
      expect(() =>
        createFathomX402Fetch({ signer: mockSigner, maxAmountAtomic: 1001n })
      ).toThrow(FathomPaymentPolicyError);
    });

    it('enforces a lowered ceiling against an otherwise canonical challenge', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': createChallenge() } })
      );

      const paidFetch = createFathomX402Fetch({
        signer: mockSigner,
        fetch: mockFetch,
        maxAmountAtomic: 500n
      });

      await expect(paidFetch(CANONICAL_URL)).rejects.toThrow();
      expect(signTypedDataCount).toBe(0);
    });

    it('ignores a smuggled terms override of the payee', async () => {
      const attacker = '0x1111111111111111111111111111111111111111';

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 402,
          headers: { 'PAYMENT-REQUIRED': createChallenge({ requirement: { payTo: attacker } }) }
        })
      );

      // `terms` is gone from the public surface; forcing it through must not work.
      const paidFetch = createFathomX402Fetch({
        signer: mockSigner,
        fetch: mockFetch,
        terms: { payTo: attacker, host: 'evil.example' }
      } as any);

      await expect(paidFetch(CANONICAL_URL)).rejects.toThrow();
      expect(signTypedDataCount).toBe(0);
      expect(CANONICAL_FATHOM_PAYMENT_TERMS.payTo).toBe(
        '0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909'.toLowerCase()
      );
    });
  });
});
