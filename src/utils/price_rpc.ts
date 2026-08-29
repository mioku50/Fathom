import { createPublicClient, http, fallback, PublicClient, Transport } from 'viem';
import { base } from 'viem/chains';
import { PricingError } from '../errors';

export function parseFallbackUrls(fallbackStr?: string): string[] {
  if (!fallbackStr) return [];
  
  const urls = fallbackStr.split(',').map(u => u.trim()).filter(u => u.length > 0);
  
  const validUrls: string[] = [];
  for (const url of urls) {
    try {
      new URL(url);
      if (!validUrls.includes(url)) {
        validUrls.push(url);
      }
    } catch {
      // Ignore invalid URLs
    }
  }
  return validUrls;
}

export function sanitizeRpcError(error: any): Error {
  const msg = error?.message || String(error);
  // Redact any URLs to prevent leaking API keys
  const sanitizedMsg = msg.replace(/https?:\/\/[^\s"']+/g, '[REDACTED_URL]');
  
  const newError = new Error(sanitizedMsg);
  newError.name = error?.name || 'Error';
  return newError;
}

export function isRpcFailure(error: any): boolean {
  const msg = error?.message?.toLowerCase() || '';
  return msg.includes('fetch failed') || 
         msg.includes('http request failed') || 
         msg.includes('rpc request failed') ||
         msg.includes('429') || 
         msg.includes('rate limit') ||
         msg.includes('500') ||
         msg.includes('502') ||
         msg.includes('503') ||
         msg.includes('504');
}

/** Minimal cache surface, so this module does not depend on the KV wiring. */
export interface DecimalsCache {
  get(key: string): Promise<any>;
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;
}

/** A token's decimals cannot change, so this can be cached for a long time. */
const DECIMALS_TTL_SECONDS = 60 * 60 * 24 * 30;

export class PriceRpcClient {
  public client: any;
  /** Per-client decimals cache; a token's decimals cannot change. */
  private decimalsCache = new Map<string, Promise<number>>();
  private sharedCache?: DecimalsCache;

  constructor(primaryUrl: string, fallbackUrlsStr?: string, sharedCache?: DecimalsCache) {
    this.sharedCache = sharedCache;
    const fallbacks = parseFallbackUrls(fallbackUrlsStr);
    const urls = [primaryUrl, ...fallbacks].filter((u, i, a) => a.indexOf(u) === i);

    const transports: Transport[] = urls.map(url => {
      return http(url, {
        // Retry the same provider before failing over. A token can sit in 30+
        // pools, so a burst of reads draws transient 429s that the next
        // provider is no more likely to absorb than a short backoff is. Failing
        // over immediately turned throttling into "no pools found".
        retryCount: 1,
        retryDelay: 150,
        // Discovery multicalls carry 60+ calls and quoter calls simulate swaps,
        // so five seconds was tight enough to be its own failure source.
        timeout: 6000
      });
    });
    
    this.client = createPublicClient({
      chain: base,
      // The fallback transport automatically handles HTTP errors, timeouts, etc.
      // and routes to the next transport in the array.
      transport: fallback(transports)
    });
  }

  async readContract(args: any) {
    try {
      return await this.client.readContract(args);
    } catch (e: any) {
      throw sanitizeRpcError(e);
    }
  }

  async multicall(args: any) {
    try {
      return await this.client.multicall(args);
    } catch (e: any) {
      throw sanitizeRpcError(e);
    }
  }

  async getTokenDecimals(tokenAddress: string, pinBlock?: bigint): Promise<number> {
    const cacheKey = `${tokenAddress.toLowerCase()}:${pinBlock ?? 'latest'}`;
    const cached = this.decimalsCache.get(cacheKey);
    if (cached) return cached;

    const pending = this.resolveDecimals(tokenAddress, pinBlock);
    this.decimalsCache.set(cacheKey, pending);
    // Do not cache a failure: a transient RPC error must not poison the token
    // for the rest of the request.
    pending.catch(() => this.decimalsCache.delete(cacheKey));
    return pending;
  }

  /**
   * Decimals are immutable, so they survive between requests. Reading them was
   * costing one RPC call per token on every request, and under provider
   * throttling that single call failing is enough to fail the whole token.
   */
  private async resolveDecimals(tokenAddress: string, pinBlock?: bigint): Promise<number> {
    const shared = this.sharedCache;
    const key = `decimals:${tokenAddress.toLowerCase()}`;

    if (shared && pinBlock === undefined) {
      try {
        const cached = await shared.get(key);
        if (typeof cached === 'number' && Number.isInteger(cached)) return cached;
      } catch {
        // A cache miss must never be the reason a token cannot be priced.
      }
    }

    const decimals = await this.readTokenDecimals(tokenAddress, pinBlock);

    if (shared && pinBlock === undefined) {
      try {
        await shared.set(key, decimals, DECIMALS_TTL_SECONDS);
      } catch {}
    }
    return decimals;
  }

  /**
   * Best-effort ERC-20 symbol, cached alongside decimals.
   *
   * Returns null rather than throwing: unlike decimals, a missing symbol
   * degrades nothing. A wrong decimals value silently rescales the price, so it
   * must fail loudly; a wrong symbol is only a label, so failing to read one is
   * not a reason to refuse the price. Some tokens also declare `symbol` as
   * bytes32 rather than string, and those simply come back unnamed.
   */
  async getTokenSymbol(tokenAddress: string): Promise<string | null> {
    const lowerToken = tokenAddress.toLowerCase();
    const canonical: Record<string, string> = {
      '0x0000000000000000000000000000000000000000': 'ETH',
      '0x4200000000000000000000000000000000000006': 'WETH',
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
      '0x940181a94a35a4569e4529a3cdfb74e38fd98631': 'AERO'
    };
    if (canonical[lowerToken]) return canonical[lowerToken];

    const shared = this.sharedCache;
    const key = `symbol:${lowerToken}`;
    if (shared) {
      try {
        const cached = await shared.get(key);
        // An empty entry is a poisoned negative from before this rule; ignore it.
        if (typeof cached === 'string' && cached !== '') return cached;
      } catch {
        // A cache miss must never be the reason a token cannot be priced.
      }
    }

    let symbol: string | null = null;
    try {
      const raw = await this.readContract({
        address: tokenAddress as any,
        abi: [{
          inputs: [],
          name: 'symbol',
          outputs: [{ internalType: 'string', name: '', type: 'string' }],
          stateMutability: 'view',
          type: 'function'
        }],
        functionName: 'symbol'
      });
      if (typeof raw === 'string') {
        // Symbols are attacker-controlled text. Trim it to something that can
        // be rendered safely and can never dominate a response.
        const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
        symbol = cleaned === '' ? null : cleaned;
      }
    } catch {
      symbol = null;
    }

    // Only a successful read is worth keeping. A throttled call and a token
    // with no symbol() are indistinguishable from here, and caching the pair of
    // them for a month freezes a passing RPC failure into a permanent "UNKNOWN".
    // Re-reading the rare genuinely unnamed token costs one call; a poisoned
    // cache costs the name of every token unlucky enough to be read during a
    // spike. This is the same rule getTokenDecimals already follows.
    if (shared && symbol !== null) {
      try {
        await shared.set(key, symbol, DECIMALS_TTL_SECONDS);
      } catch {}
    }
    return symbol;
  }

  private async readTokenDecimals(tokenAddress: string, pinBlock?: bigint): Promise<number> {
    const canonical: Record<string, number> = {
      // Uniswap v4 denominates native ETH as address(0). It has no decimals()
      // to call, so it must be known rather than read.
      '0x0000000000000000000000000000000000000000': 18, // native ETH
      '0x4200000000000000000000000000000000000006': 18, // WETH
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 6,  // USDC
      '0x940181a94A35A4569E4529A3CDfB74e38FD98631': 18  // AERO
    };

    const lowerToken = tokenAddress.toLowerCase();
    for (const [addr, dec] of Object.entries(canonical)) {
      if (addr.toLowerCase() === lowerToken) {
        return dec;
      }
    }

    // A throttled eth_call should not cost the whole token. An out-of-range
    // answer is deterministic, so it is not worth repeating.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.readDecimalsOnce(tokenAddress, pinBlock);
      } catch (error) {
        lastError = error;
        if (error instanceof PricingError && error.deterministic) throw error;
        if (attempt < 2) await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
      }
    }

    throw lastError instanceof PricingError
      ? lastError
      : new PricingError('unknown_decimals', `Could not read decimals() for token ${tokenAddress}`);
  }

  private async readDecimalsOnce(tokenAddress: string, pinBlock?: bigint): Promise<number> {
    try {
      const dec = await this.readContract({
        address: tokenAddress as any,
        abi: [{
          inputs: [],
          name: "decimals",
          outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
          stateMutability: "view",
          type: "function"
        }],
        functionName: 'decimals',
        blockNumber: pinBlock
      });
      const parsed = Number(dec);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 77) {
        throw new PricingError(
          'unknown_decimals',
          `Token ${tokenAddress} returned an out-of-range decimals value`,
          true // deterministic: the contract will keep saying the same thing
        );
      }
      return parsed;
    } catch (e) {
      if (e instanceof PricingError) throw e;
      // Never guess. A wrong decimals value silently rescales the price by
      // orders of magnitude, which is worse than returning no price at all.
      throw new PricingError(
        'unknown_decimals',
        `Could not read decimals() for token ${tokenAddress}`
      );
    }
  }
}
