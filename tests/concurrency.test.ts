import { describe, it, expect, vi } from 'vitest';
import { mapWithConcurrency } from '../src/concurrency';

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const items = [50, 10, 30, 0, 20];

    const results = await mapWithConcurrency(items, 3, async (delay, i) => {
      await new Promise(r => setTimeout(r, delay));
      return `${i}:${delay}`;
    });

    expect(results).toEqual(['0:50', '1:10', '2:30', '3:0', '4:20']);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // and it really is running in parallel
  });

  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      seen.push(n);
      return n;
    });

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('handles an empty input', async () => {
    const worker = vi.fn();
    expect(await mapWithConcurrency([], 5, worker as any)).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('clamps a nonsensical limit to at least one', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 0, async n => n * 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it('propagates a worker rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async n => {
        if (n === 2) throw new Error('boom');
        return n;
      })
    ).rejects.toThrow('boom');
  });
});
