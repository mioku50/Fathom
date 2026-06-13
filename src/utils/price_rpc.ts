import { createPublicClient, http, fallback, PublicClient, Transport } from 'viem';
import { base } from 'viem/chains';

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
}
