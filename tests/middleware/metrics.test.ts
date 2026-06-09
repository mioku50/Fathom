import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { metricsMiddleware, InMemoryMetricsStorage } from '../../src/middleware/metrics'

describe('Metrics Middleware', () => {
  let storage: InMemoryMetricsStorage;
  let app: Hono;

  beforeEach(() => {
    storage = new InMemoryMetricsStorage();
    app = new Hono();
    app.use('*', metricsMiddleware(storage));
  });

  it('should count successful requests correctly', async () => {
    app.get('/test', (c) => c.text('ok', 200));

    await app.request('/test');

    expect(storage.requestCounts['GET /test 200']).toBe(1);

    await app.request('/test');
    expect(storage.requestCounts['GET /test 200']).toBe(2);
  });

  it('should count error responses correctly', async () => {
    app.get('/error', (c) => c.text('error', 500));

    await app.request('/error');

    expect(storage.requestCounts['GET /error 500']).toBe(1);
    expect(storage.requestCounts['GET /error 200']).toBeUndefined();
  });

  it('should track latency correctly', async () => {
    vi.useFakeTimers();
    app.get('/slow', async (c) => {
      // simulate 100ms delay
      vi.advanceTimersByTime(100);
      return c.text('slow', 200);
    });

    // Start request asynchronously
    const requestPromise = app.request('/slow');
    // Ensure the timers are advanced while the request is pending
    await Promise.resolve(); // Allow the request handler to run up to the await

    await requestPromise;

    expect(storage.latencies['GET /slow']).toHaveLength(1);
    expect(storage.latencies['GET /slow'][0]).toBeGreaterThanOrEqual(100);
    vi.useRealTimers();
  });
});
