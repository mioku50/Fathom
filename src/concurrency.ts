/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving input
 * order in the returned array.
 *
 * Batch pricing was fully sequential, so a 50-token request paid the full
 * round-trip latency of every token in series. Unbounded Promise.all is not the
 * fix either: it would fan out 50 tokens' worth of RPC calls at once and invite
 * provider rate limiting and the Workers subrequest ceiling.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const effectiveLimit = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  const runners = Array.from({ length: effectiveLimit }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
