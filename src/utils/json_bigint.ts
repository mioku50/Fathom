/**
 * JSON that survives bigint.
 *
 * Pool state is read as bigint - reserves, liquidity, sqrtPriceX96 - and
 * `JSON.stringify` throws on bigint rather than coercing it. The orchestrator's
 * KV cache wrapped its write in a bare `catch {}`, so every raw-pool write threw
 * and was swallowed: the cache reported no error and never stored a single
 * entry. Every request re-read every pool, which is precisely the load the cache
 * existed to remove.
 *
 * Encoding a bigint as a plain string would not do, because the decoder could
 * not tell it from a genuine string - `token0` is an address, `reserve0` is a
 * number, and both would come back as text. The tagged form keeps the two
 * distinguishable, so a round trip returns the types it was given.
 */

const BIGINT_TAG = '$bigint';

type TaggedBigInt = { [BIGINT_TAG]: string };

function isTaggedBigInt(value: unknown): value is TaggedBigInt {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[BIGINT_TAG] === 'string'
  );
}

/** JSON.stringify, but bigint round-trips instead of throwing. */
export function stringifyWithBigInt(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    typeof val === 'bigint' ? { [BIGINT_TAG]: val.toString() } : val
  );
}

/** Inverse of {@link stringifyWithBigInt}; plain JSON parses unchanged. */
export function parseWithBigInt(text: string): unknown {
  return JSON.parse(text, (_key, val) => (isTaggedBigInt(val) ? BigInt(val[BIGINT_TAG]) : val));
}
