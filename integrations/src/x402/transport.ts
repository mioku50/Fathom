import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { FathomPaymentPolicyError } from '../core/errors.js';

export interface EvmSigner {
  address: `0x${string}` | string;
  signTypedData: (params: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}` | string>;
}

export interface FathomPaymentTerms {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  maxAmountAtomic: bigint;
  /** Exact `URL.host` — includes a port, so a non-default port does not match. */
  host: string;
  path: string;
}

/**
 * Exact live payment terms for Fathom API (/v1/assess on Base mainnet).
 *
 * Enforces fail-closed validation across all six dimensions:
 * 1. scheme: exact
 * 2. network: eip155:8453 (Base mainnet)
 * 3. amount: <= 1000 atomic units (0.001 USDC ceiling)
 * 4. asset: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (Base native USDC)
 * 5. payTo: 0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909
 * 6. resource: fathom-api.mioku-fathom.workers.dev/v1/assess
 *
 * These are not configurable. A caller that could replace `payTo`, `asset` or the
 * amount ceiling could redirect this package's payments anywhere, which would make
 * "canonical" and "fail-closed" untrue. The only permitted adjustment is a LOWER
 * spend ceiling, via `maxAmountAtomic` on the factory options.
 */
export const CANONICAL_FATHOM_PAYMENT_TERMS: Readonly<FathomPaymentTerms> = Object.freeze({
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(),
  payTo: '0x8e525BfCe1eF40Aa8075ef64E45421b5855C8909'.toLowerCase(),
  maxAmountAtomic: 1000n,
  host: 'fathom-api.mioku-fathom.workers.dev',
  path: '/v1/assess'
});

/**
 * The only adjustment a caller may make to the payment policy.
 *
 * `maxAmountAtomic` can lower the per-call spend ceiling below the canonical 1000
 * atomic units (0.001 USDC). It can never raise it, and nothing else is settable.
 */
export interface FathomPaymentPolicyOptions {
  maxAmountAtomic?: bigint;
}

export interface CreateFathomX402FetchOptions extends FathomPaymentPolicyOptions {
  signer: EvmSigner;
  fetch?: typeof globalThis.fetch;
}

function resolvePolicy(options?: FathomPaymentPolicyOptions): FathomPaymentTerms {
  const terms: FathomPaymentTerms = { ...CANONICAL_FATHOM_PAYMENT_TERMS };
  const requested = options?.maxAmountAtomic;
  if (requested !== undefined) {
    if (typeof requested !== 'bigint' || requested < 0n) {
      throw new FathomPaymentPolicyError(
        'maxAmountAtomic must be a non-negative bigint'
      );
    }
    if (requested > CANONICAL_FATHOM_PAYMENT_TERMS.maxAmountAtomic) {
      throw new FathomPaymentPolicyError(
        `maxAmountAtomic may only lower the canonical ceiling of ` +
          `${CANONICAL_FATHOM_PAYMENT_TERMS.maxAmountAtomic} atomic units; got ${requested}`
      );
    }
    terms.maxAmountAtomic = requested;
  }
  return terms;
}

/** Extracts the URL from anything the fetch API accepts, without a network call. */
function targetUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

/**
 * Validates the URL a request is actually going to, before it is sent.
 *
 * This is deliberately separate from the 402-challenge check. The challenge is
 * supplied by the server being talked to, so a malicious host can advertise
 * Fathom's canonical resource and otherwise-canonical terms while receiving the
 * signed payment itself. Validating only the advertised resource authorises that
 * split target; validating only the request URL misses a canonical host serving a
 * tampered challenge. Both gates must pass.
 *
 * Query parameters are preserved and ignored here: the canonical challenge
 * resource is query-free while real requests carry `token` and `size_usd`.
 */
export function assertFathomRequestTarget(
  input: RequestInfo | URL,
  terms: FathomPaymentTerms = CANONICAL_FATHOM_PAYMENT_TERMS
): void {
  const raw = targetUrlOf(input);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FathomPaymentPolicyError(
      `Refusing to send a payable request to an unparseable URL: ${raw}`
    );
  }

  if (url.protocol !== 'https:') {
    throw new FathomPaymentPolicyError(
      `Refusing to send a payable request over ${url.protocol}//; https is required`
    );
  }

  // `URL.host` carries a non-default port, `hostname` does not. Comparing `host`
  // is what makes `https://fathom-api.mioku-fathom.workers.dev:8443` fail.
  if (url.host !== terms.host) {
    throw new FathomPaymentPolicyError(
      `Refusing to send a payable request to ${url.host}; only ${terms.host} is allowed`
    );
  }

  if (url.pathname !== terms.path) {
    throw new FathomPaymentPolicyError(
      `Refusing to send a payable request to ${url.pathname}; only ${terms.path} is allowed`
    );
  }
}

/**
 * Creates an official x402Client configured with Fathom's fail-closed policy.
 */
export function createFathomX402Client(
  signer: EvmSigner,
  options?: FathomPaymentPolicyOptions
): x402Client {
  const terms = resolvePolicy(options);

  const client = new x402Client().register(
    terms.network as any,
    new ExactEvmScheme(signer as any)
  );

  // Policy filters requirements: scheme, network, asset, payTo, amount ceiling
  client.registerPolicy((_version: number, requirements: any[]) => {
    return requirements.filter((req: any) => {
      if (req.scheme !== terms.scheme) return false;
      if (req.network !== terms.network) return false;
      if (req.asset?.toLowerCase() !== terms.asset.toLowerCase()) return false;
      if (req.payTo?.toLowerCase() !== terms.payTo.toLowerCase()) return false;
      try {
        if (BigInt(req.amount) > terms.maxAmountAtomic) return false;
      } catch {
        return false;
      }
      return true;
    });
  });

  // Second gate: the resource the challenge advertises must also be canonical.
  // Runs before any typed data is signed.
  client.onBeforePaymentCreation(async (ctx: any) => {
    const resourceUrl = ctx.paymentRequired?.resource?.url;
    if (!resourceUrl) {
      return { abort: true, reason: 'Payment challenge missing resource.url' };
    }
    try {
      const parsed = new URL(resourceUrl);
      if (
        parsed.protocol !== 'https:' ||
        parsed.host !== terms.host ||
        parsed.pathname !== terms.path
      ) {
        return {
          abort: true,
          reason: `Advertised resource ${parsed.protocol}//${parsed.host}${parsed.pathname} does not match allowed https://${terms.host}${terms.path}`
        };
      }
    } catch {
      return { abort: true, reason: `Invalid resource URL: ${resourceUrl}` };
    }
  });

  return client;
}

/**
 * Returns a payment-enabled fetch function that transparently handles x402 challenges
 * for the Fathom API while strictly enforcing the fail-closed policy.
 */
export function createFathomX402Fetch(
  options: CreateFathomX402FetchOptions
): typeof globalThis.fetch {
  const terms = resolvePolicy(options);
  const baseFetch = options.fetch ?? globalThis.fetch;

  // Guard the transport at its only chokepoint: every request the SDK makes goes
  // through this, the unpaid probe and the paid retry alike. A redirect the SDK
  // followed to another host would be caught here too.
  //
  // Both wrappers are async so a refusal arrives as a rejected promise. A
  // fetch-shaped function that throws synchronously breaks every `.catch()` a
  // caller would reasonably write.
  const guardedFetch: typeof globalThis.fetch = async (input, init) => {
    assertFathomRequestTarget(input, terms);
    return baseFetch(input, init);
  };

  const client = createFathomX402Client(options.signer, options);
  const paidFetch = wrapFetchWithPayment(guardedFetch, client);

  // Also reject at the entry point, so a caller sees the policy error before any
  // network call rather than wrapped in the SDK's retry machinery.
  return async (input, init) => {
    assertFathomRequestTarget(input, terms);
    return paidFetch(input, init);
  };
}
