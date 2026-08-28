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

export class PriceRpcClient {
  public client: any;

  constructor(primaryUrl: string, fallbackUrlsStr?: string) {
    const fallbacks = parseFallbackUrls(fallbackUrlsStr);
    const urls = [primaryUrl, ...fallbacks].filter((u, i, a) => a.indexOf(u) === i);

    const transports: Transport[] = urls.map((url, i) => {
      return http(url, { 
        retryCount: 0, // Fallback transport handles retrying next provider
        timeout: 5000,
        fetchOptions: {
          // You could add custom fetch options here if needed
        }
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
    const canonical: Record<string, number> = {
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
          `Token ${tokenAddress} returned an out-of-range decimals value`
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
