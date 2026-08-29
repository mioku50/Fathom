import { describe, it, expect } from 'vitest';
import { stringifyWithBigInt, parseWithBigInt } from '../../src/utils/json_bigint';
import type { RawPoolData } from '../../src/dex_adapter';

describe('bigint-safe JSON', () => {
  it('does not throw on the shape the raw-pool cache actually stores', () => {
    const raw: RawPoolData = {
      reserve0: 123456789012345678901234567890n,
      reserve1: 987654321n,
      liquidity: 42n,
      sqrtPriceX96: 79228162514264337593543950336n,
      tick: -887220,
      token0: '0x4200000000000000000000000000000000000006',
      token1: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      updatedAt: 1735689600
    };

    // Plain JSON.stringify throws here, which is how every raw-pool cache write
    // failed silently inside a bare catch.
    expect(() => JSON.stringify(raw)).toThrow(TypeError);
    expect(() => stringifyWithBigInt(raw)).not.toThrow();
  });

  it('round-trips bigint as bigint, not as a string', () => {
    const raw: RawPoolData = {
      reserve0: 123456789012345678901234567890n,
      reserve1: 1n,
      token0: '0xabc',
      token1: '0xdef',
      updatedAt: 7
    };

    const back = parseWithBigInt(stringifyWithBigInt(raw)) as RawPoolData;

    expect(typeof back.reserve0).toBe('bigint');
    expect(back.reserve0).toBe(raw.reserve0);
    expect(back).toEqual(raw);
  });

  it('keeps addresses as strings, so a decoder cannot confuse the two', () => {
    const back = parseWithBigInt(
      stringifyWithBigInt({ token0: '0x0000000000000000000000000000000000000001', reserve0: 1n })
    ) as any;

    expect(typeof back.token0).toBe('string');
    expect(typeof back.reserve0).toBe('bigint');
  });

  it('survives a value that merely looks like the tag', () => {
    const back = parseWithBigInt(stringifyWithBigInt({ note: '$bigint', nested: { $bigint: 5 } })) as any;
    expect(back.note).toBe('$bigint');
    // A numeric payload is not the tagged form, so it stays what it was.
    expect(back.nested).toEqual({ $bigint: 5 });
  });

  it('leaves ordinary JSON untouched in both directions', () => {
    const plain = { a: 1, b: 'two', c: [3, null, true], d: { e: null } };
    expect(parseWithBigInt(stringifyWithBigInt(plain))).toEqual(plain);
    expect(stringifyWithBigInt(plain)).toBe(JSON.stringify(plain));
  });

  it('handles bigints nested in arrays', () => {
    const back = parseWithBigInt(stringifyWithBigInt({ sizes: [1n, 2n, 3n] })) as any;
    expect(back.sizes).toEqual([1n, 2n, 3n]);
  });
});
