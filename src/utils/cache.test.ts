import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Cache, createCache, CachePresets } from './cache.js';

describe('Cache', () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache();
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete entries', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);

      const deleted = cache.delete('key1');
      expect(deleted).toBe(true);
      expect(cache.has('key1')).toBe(false);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should return false when deleting non-existent key', () => {
      const deleted = cache.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
    });

    it('should track cache size', () => {
      expect(cache.size()).toBe(0);

      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);

      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      cache.delete('key1');
      expect(cache.size()).toBe(1);
    });

    it('should get all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const keys = cache.keys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toHaveLength(2);
    });

    it('should get all values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const values = cache.values();
      expect(values).toContain('value1');
      expect(values).toContain('value2');
      expect(values).toHaveLength(2);
    });
  });

  describe('TTL (Time-To-Live)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should expire entries after TTL', () => {
      cache = new Cache({ defaultTTL: 1000, enableCleanup: false });

      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');

      // Advance time by 1001ms (past TTL)
      vi.advanceTimersByTime(1001);

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.has('key1')).toBe(false);
    });

    it('should use custom TTL for individual entries', () => {
      cache = new Cache({ defaultTTL: 5000, enableCleanup: false });

      cache.set('key1', 'value1', 1000); // Custom TTL of 1 second
      cache.set('key2', 'value2'); // Uses default TTL of 5 seconds

      // Advance time by 1001ms
      vi.advanceTimersByTime(1001);

      expect(cache.get('key1')).toBeUndefined(); // Should be expired
      expect(cache.get('key2')).toBe('value2'); // Should still exist
    });

    it('should handle entries with very long TTL', () => {
      // Use a very long TTL (1 hour) to test entries that don't expire quickly
      cache = new Cache({ defaultTTL: 60 * 60 * 1000, enableCleanup: false });

      cache.set('key1', 'value1');

      // Advance time by 10 seconds - entry should still exist
      vi.advanceTimersByTime(10000);

      expect(cache.get('key1')).toBe('value1');
    });

    it('should manually cleanup expired entries', () => {
      cache = new Cache({ defaultTTL: 1000, enableCleanup: false });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      // Advance time past TTL
      vi.advanceTimersByTime(1001);

      const cleanedCount = cache.cleanup();
      expect(cleanedCount).toBe(2);
      expect(cache.size()).toBe(0);
    });
  });

  describe('Size Limits and Eviction', () => {
    it('should evict entries when max size is reached (LRU)', () => {
      cache = new Cache({ maxSize: 2, evictionPolicy: 'lru', enableCleanup: false });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      // Access key1 to make it more recently used
      cache.get('key1');

      // Add third entry, should evict key2 (least recently used)
      cache.set('key3', 'value3');
      expect(cache.size()).toBe(2);
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
    });

    it('should evict entries when max size is reached (FIFO)', () => {
      cache = new Cache({ maxSize: 2, evictionPolicy: 'fifo', enableCleanup: false });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      // Access key1 (shouldn't matter for FIFO)
      cache.get('key1');

      // Add third entry, should evict key1 (first in)
      cache.set('key3', 'value3');
      expect(cache.size()).toBe(2);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
    });

    it('should handle updating existing keys without eviction', () => {
      cache = new Cache({ maxSize: 2, enableCleanup: false });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      // Update existing key
      cache.set('key1', 'updated_value1');
      expect(cache.size()).toBe(2);
      expect(cache.get('key1')).toBe('updated_value1');
      expect(cache.has('key2')).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses', () => {
      cache.set('key1', 'value1');

      // Hit
      cache.get('key1');

      // Miss
      cache.get('nonexistent');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(50);
    });

    it('should track evictions', () => {
      cache = new Cache({ maxSize: 1, enableCleanup: false });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2'); // Should evict key1

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });

    it('should track expirations', () => {
      vi.useFakeTimers();
      cache = new Cache({ defaultTTL: 1000, enableCleanup: false });

      cache.set('key1', 'value1');

      // Advance time past TTL
      vi.advanceTimersByTime(1001);

      // Try to access expired entry
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.expirations).toBe(1);

      vi.useRealTimers();
    });

    it('should reset statistics', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // Hit
      cache.get('nonexistent'); // Miss

      let stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      cache.resetStats();

      stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('Automatic Cleanup', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should automatically cleanup expired entries', () => {
      cache = new Cache({
        defaultTTL: 1000,
        enableCleanup: true,
        cleanupInterval: 500
      });

      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);

      // Advance time past TTL but before cleanup interval
      vi.advanceTimersByTime(1001);
      expect(cache.size()).toBe(1); // Still there, cleanup hasn't run

      // Advance time to trigger cleanup
      vi.advanceTimersByTime(500);
      expect(cache.size()).toBe(0); // Should be cleaned up
    });

    it('should stop cleanup timer when destroyed', () => {
      cache = new Cache({ enableCleanup: true, cleanupInterval: 100 });

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      cache.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('Type Safety', () => {
    it('should work with typed values', () => {
      interface User {
        id: number;
        name: string;
      }

      const userCache = new Cache<User>();
      const user: User = { id: 1, name: 'John' };

      userCache.set('user1', user);
      const retrieved = userCache.get('user1');

      expect(retrieved).toEqual(user);
      expect(retrieved?.id).toBe(1);
      expect(retrieved?.name).toBe('John');
    });
  });
});

describe('createCache', () => {
  it('should create a cache instance', () => {
    const cache = createCache({ maxSize: 100 });
    expect(cache).toBeInstanceOf(Cache);

    cache.set('test', 'value');
    expect(cache.get('test')).toBe('value');

    cache.destroy();
  });
});

describe('CachePresets', () => {
  it('should provide predefined configurations', () => {
    expect(CachePresets.small.maxSize).toBe(100);
    expect(CachePresets.medium.maxSize).toBe(500);
    expect(CachePresets.large.maxSize).toBe(2000);
    expect(CachePresets.persistent.maxSize).toBe(1000);

    expect(CachePresets.small.evictionPolicy).toBe('lru');
    expect(CachePresets.persistent.evictionPolicy).toBe('fifo');
  });

  it('should work with preset configurations', () => {
    const cache = new Cache(CachePresets.small);

    cache.set('test', 'value');
    expect(cache.get('test')).toBe('value');

    const stats = cache.getStats();
    expect(stats.maxSize).toBe(100);

    cache.destroy();
  });
});