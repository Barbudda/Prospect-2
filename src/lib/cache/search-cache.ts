// In-memory LRU search cache with TTL.
//
// Why in-memory and not Supabase: a persistent cache requires a schema
// migration we can't safely apply from this tool. A Vercel cold start
// flushes this cache, which is acceptable — a single 5-minute mass run
// gets full benefit, and the worst case is the first request paying the
// scraper cost (which is what we'd do without a cache anyway).
//
// When we move to durable storage, the API stays the same — just swap
// the Map for a Supabase-backed implementation.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_ENTRIES = 1000;

class LRUTtlCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    // Refresh LRU ordering
    this.store.delete(key);
    this.store.set(key, e);
    return e.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    while (this.store.size > MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
  }

  stats() {
    return { size: this.store.size, max: MAX_ENTRIES };
  }
}

const cache = new LRUTtlCache();

export function makeKey(parts: Array<string | number | boolean | undefined>): string {
  return parts
    .map((p) => (p === undefined || p === null ? "" : String(p)))
    .map((s) => s.toLowerCase().trim().replace(/\s+/g, " "))
    .join("|");
}

export function getCached<T>(key: string): T | null {
  return cache.get<T>(key);
}

export function setCached<T>(key: string, value: T, ttlSeconds: number): void {
  cache.set(key, value, ttlSeconds);
}

export function cacheStats() {
  return cache.stats();
}
