import { createMiddleware } from 'hono/factory'

export interface MetricsStorage {
  incrementRequestCount(path: string, method: string, status: number): void;
  recordLatency(path: string, method: string, latencyMs: number): void;
}

// In-memory fallback for testing or standalone usage
export class InMemoryMetricsStorage implements MetricsStorage {
  public requestCounts: Record<string, number> = {};
  public latencies: Record<string, number[]> = {};

  incrementRequestCount(path: string, method: string, status: number): void {
    const key = `${method} ${path} ${status}`;
    this.requestCounts[key] = (this.requestCounts[key] || 0) + 1;
  }

  recordLatency(path: string, method: string, latencyMs: number): void {
    const key = `${method} ${path}`;
    if (!this.latencies[key]) {
      this.latencies[key] = [];
    }
    this.latencies[key].push(latencyMs);
  }
}

export const metricsMiddleware = (storage: MetricsStorage) => {
  return createMiddleware(async (c, next) => {
    const start = Date.now();
    await next();
    const latencyMs = Date.now() - start;

    const path = c.req.path;
    const method = c.req.method;
    const status = c.res.status;

    storage.incrementRequestCount(path, method, status);
    storage.recordLatency(path, method, latencyMs);
  })
}
