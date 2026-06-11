const fs = require('fs');

let content = fs.readFileSync('src/index.ts', 'utf8');

// We need an adapter to match the CacheLayer interface expected by DEXOrchestrator
// CacheLayer expects:
// get(key: string): Promise<any>
// set(key: string, value: any, ttlSeconds?: number): Promise<void>
// But KVCacheLayer expects:
// get(token: string, chain: string): Promise<PriceResponse | null>
// set(token: string, chain: string, response: PriceResponse, ttlSeconds?: number): Promise<void>

// We can just use c.env?.FATHOM_KV as a base for a simple wrapper since it implements get(key) and put(key) if available.
// Or we can create a simple wrapper.
// Since orchestrator expects string keys, and KVCacheLayer expects (token, chain).
// Actually, KVCacheLayer uses kv directly. KVCacheLayer cannot be used directly as CacheLayer.
// Let's create an adapter inside the routes or globally.

const wrapperClass = `
class OrchestratorCacheAdapter implements CacheLayer {
  constructor(private kv?: KVNamespace, private defaultTTL: number = 60) {}
  async get(key: string): Promise<any> {
    if (!this.kv) return null;
    try {
      const val = await this.kv.get(key, 'json');
      return val;
    } catch {
      return null;
    }
  }
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.kv) return;
    try {
      await this.kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds || this.defaultTTL });
    } catch {}
  }
}
`;

// wait, KVCacheLayer does not implement CacheLayer interface. We need to import CacheLayer
content = content.replace(
  "import { DEXOrchestrator } from './orchestrator'",
  "import { DEXOrchestrator, type CacheLayer } from './orchestrator'\n\n" + wrapperClass
);

content = content.replace(
  /const orchestrator = new DEXOrchestrator\(adapters, cacheLayer\);/g,
  "const orchestrator = new DEXOrchestrator(adapters, new OrchestratorCacheAdapter(c.env?.FATHOM_KV, defaultTTL));"
);

fs.writeFileSync('src/index.ts', content);
