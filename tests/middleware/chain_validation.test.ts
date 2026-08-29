import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { validateChainMiddleware, SUPPORTED_CHAINS } from '../../src/middleware/validation';

/**
 * `chain` was accepted unvalidated on the price endpoints, so a request for
 * `chain=ethereum` was answered with Base data stamped "ethereum" - a wrong
 * answer, cached under its own key, and charged for.
 */
describe('validateChainMiddleware', () => {
  const app = new Hono();
  app.get('/probe', validateChainMiddleware, c => c.json({ reached: true }));

  it('lets the supported chain through', async () => {
    const res = await app.request('/probe?chain=base');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });

  it('lets an absent chain through, preserving the base default', async () => {
    const res = await app.request('/probe');
    expect(res.status).toBe(200);
  });

  it('rejects a chain Fathom does not read', async () => {
    const res = await app.request('/probe?chain=ethereum');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; message: string };
    expect(body.error).toBe('invalid_request');
    expect(body.message).toContain('ethereum');
  });

  it('does not reach the handler for an unsupported chain', async () => {
    const res = await app.request('/probe?chain=arbitrum');
    expect(await res.json()).not.toHaveProperty('reached');
  });

  it('is case-sensitive rather than quietly normalising', async () => {
    // Accepting "Base" would mean echoing a chain string we never validated.
    expect((await app.request('/probe?chain=Base')).status).toBe(400);
  });

  it('rejects an empty-but-present chain only if it is not falsy', async () => {
    // An empty value is indistinguishable from omission and falls back to base.
    expect((await app.request('/probe?chain=')).status).toBe(200);
  });

  it('advertises exactly the chains it accepts', () => {
    expect(SUPPORTED_CHAINS).toEqual(['base']);
  });
});
