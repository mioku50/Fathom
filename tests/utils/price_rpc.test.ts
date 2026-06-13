import { describe, it, expect } from 'vitest';
import { parseFallbackUrls } from '../../src/utils/price_rpc';

describe('parseFallbackUrls', () => {
  it('parses correctly', () => {
    expect(parseFallbackUrls('http://a, http://b ')).toEqual(['http://a', 'http://b']);
  });
});
