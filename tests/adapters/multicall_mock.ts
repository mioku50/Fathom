import { vi } from 'vitest';

/**
 * Adapters batch their reads through `multicall`. Tests describe behaviour one
 * call at a time, so this adapts a per-contract resolver into the two shapes
 * viem's multicall returns:
 *   allowFailure: true  -> [{ status, result | error }, ...]
 *   allowFailure: false -> [result, ...], throwing on the first failure
 */
export function makeMulticallMock(resolve: (contract: any) => any) {
  return vi.fn(async ({ contracts, allowFailure }: any) => {
    const settled = await Promise.all(
      contracts.map(async (contract: any) => {
        try {
          return { status: 'success' as const, result: await resolve(contract) };
        } catch (error) {
          return { status: 'failure' as const, error };
        }
      })
    );

    if (allowFailure === false) {
      const failure = settled.find(r => r.status === 'failure') as any;
      if (failure) throw failure.error;
      return settled.map((r: any) => r.result);
    }

    return settled;
  });
}
