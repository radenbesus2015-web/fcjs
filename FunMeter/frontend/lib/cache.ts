// lib/cache.ts
// Advanced caching system with lazy loading and performance optimization

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Cache configuration interface
interface CacheConfig {
  ttl?: number; // Time to live in milliseconds
  maxSize?: number; // Maximum cache size
  enablePersistence?: boolean; // Store in localStorage
  enableCompression?: boolean; // Compress data
}

// Cache entry interface
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
}

// Cache statistics
interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

// Default cache configuration
const DEFAULT_CONFIG: Required<CacheConfig> = {
  ttl: 5 * 60 * 1000, // 5 minutes
  maxSize: 100,
  enablePersistence: true,
  enableCompression: false
};

class LazyCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private config: Required<CacheConfig>;
  private stats = { hits: 0, misses: 0 };
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: CacheConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
    this.loadFromPersistence();
  }

  // Get data from cache with lazy loading
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if entry is expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this.stats.hits++;

    return entry.data;
  }

  // Set data in cache with automatic cleanup
  set<T>(key: string, data: T, customTtl?: number): void {
    const ttl = customTtl || this.config.ttl;
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      accessCount: 1,
      lastAccessed: Date.now()
    };

    // Check cache size limit
    if (this.cache.size >= this.config.maxSize) {
      this.evictLeastUsed();
    }

    this.cache.set(key, entry as CacheEntry<unknown>);
    this.saveToPersistence();
  }

  // Check if cache has valid entry
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  // Delete specific entry
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    this.saveToPersistence();
    return result;
  }

  // Clear all cache
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
    this.saveToPersistence();
  }

  // Get cache statistics
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0
    };
  }

  // Invalidate entries by pattern
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    this.saveToPersistence();
    return count;
  }

  // Preload data with lazy loading
  async preload<T>(key: string, loader: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    try {
      const data = await loader();
      this.set(key, data, ttl);
      return data;
    } catch (error) {
      console.error(`Cache preload failed for key: ${key}`, error);
      throw error;
    }
  }

  // Batch operations
  setMany<T>(entries: Array<{ key: string; data: T; ttl?: number }>): void {
    entries.forEach(({ key, data, ttl }) => {
      this.set(key, data, ttl);
    });
  }

  getMany<T>(keys: string[]): Array<{ key: string; data: T | null }> {
    return keys.map(key => ({
      key,
      data: this.get<T>(key)
    }));
  }

  // Private methods
  private isExpired(entry: CacheEntry<unknown>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private evictLeastUsed(): void {
    let leastUsedKey = '';
    let leastUsedScore = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      // Score based on access count and recency
      const score = entry.accessCount / (Date.now() - entry.lastAccessed + 1);
      if (score < leastUsedScore) {
        leastUsedScore = score;
        leastUsedKey = key;
      }
    }

    if (leastUsedKey) {
      this.cache.delete(leastUsedKey);
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60000); // Cleanup every minute
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
    this.saveToPersistence();
  }

  private saveToPersistence(): void {
    if (!this.config.enablePersistence || typeof window === 'undefined') return;

    try {
      const serialized = JSON.stringify(Array.from(this.cache.entries()));
      localStorage.setItem('lazy-cache', serialized);
    } catch (error) {
      console.warn('Failed to save cache to localStorage:', error);
    }
  }

  private loadFromPersistence(): void {
    if (!this.config.enablePersistence || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem('lazy-cache');
      if (stored) {
        const entries = JSON.parse(stored);
        this.cache = new Map(entries);
        
        // Clean expired entries on load
        this.cleanup();
      }
    } catch (error) {
      console.warn('Failed to load cache from localStorage:', error);
    }
  }

  // Cleanup on destroy
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.clear();
  }
}

// Global cache instance
export const globalCache = new LazyCache({
  ttl: 10 * 60 * 1000, // 10 minutes
  maxSize: 200,
  enablePersistence: true
});

// Hook for using cache with React
export function useCache<T>(
  key: string,
  loader: () => Promise<T>,
  options: {
    ttl?: number;
    enabled?: boolean;
    dependencies?: unknown[];
  } = {}
) {
  const { ttl, enabled = true, dependencies = [] } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  // Memoize cache key with dependencies
  const cacheKey = useMemo(() => {
    const depsHash = dependencies.length > 0 
      ? JSON.stringify(dependencies) 
      : '';
    return `${key}${depsHash ? `_${btoa(depsHash)}` : ''}`;
  }, [key, dependencies]);

  const loadData = useCallback(async (force = false) => {
    if (!enabled) return;

    // Check cache first
    if (!force) {
      const cached = globalCache.get<T>(cacheKey);
      if (cached !== null) {
        setData(cached);
        setError(null);
        return cached;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const result = await loaderRef.current();
      globalCache.set(cacheKey, result, ttl);
      setData(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [cacheKey, enabled, ttl]);

  // Load data on mount and dependency changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  const invalidate = useCallback(() => {
    globalCache.delete(cacheKey);
    return loadData(true);
  }, [cacheKey, loadData]);

  const mutate = useCallback((newData: T) => {
    globalCache.set(cacheKey, newData, ttl);
    setData(newData);
    setError(null);
  }, [cacheKey, ttl]);

  return {
    data,
    loading,
    error,
    invalidate,
    mutate,
    reload: () => loadData(true)
  };
}

// Hook for lazy loading with intersection observer
export function useLazyLoad(
  threshold = 0.1,
  rootMargin = '50px'
) {
  const [isVisible, setIsVisible] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // FIX: harus HTMLDivElement agar cocok dengan <div ref={ref}>
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || hasLoaded) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          setHasLoaded(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [threshold, rootMargin, hasLoaded]);

  return { ref: elementRef, isVisible, hasLoaded };
}


// Memory optimization utilities
export const memoizeWithCache = <T extends (...args: unknown[]) => unknown>(
  fn: T,
  keyGenerator?: (...args: Parameters<T>) => string
): T => {
  const cache = new Map<string, ReturnType<T>>();

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args);
    
    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = fn(...args) as ReturnType<T>;
    cache.set(key, result);
    
    // Limit cache size
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) {
        cache.delete(firstKey);
      }
    }

    return result;
  }) as T;
};

// Debounced cache operations
export function useDebouncedCache<T>(
  key: string,
  value: T,
  delay = 300
) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      globalCache.set(key, value);
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [key, value, delay]);
}

export default LazyCache;
