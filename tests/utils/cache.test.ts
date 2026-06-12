import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryCache } from '../../src/utils/cache';

describe('MemoryCache', () => {
  let cache: MemoryCache<string>;

  beforeEach(() => {
    cache = new MemoryCache<string>();
  });

  it('should store and retrieve a value', () => {
    cache.set('key1', 'value1', 60);
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for missing key', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('should expire values after TTL', () => {
    vi.useFakeTimers();
    cache.set('key1', 'value1', 60);

    vi.advanceTimersByTime(61000);
    expect(cache.get('key1')).toBeUndefined();

    vi.useRealTimers();
  });

  it('should delete a value', () => {
    cache.set('key1', 'value1', 60);
    cache.delete('key1');
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should clear all values', () => {
    cache.set('key1', 'value1', 60);
    cache.set('key2', 'value2', 60);
    cache.clear();
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });
});
