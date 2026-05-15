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

// ── Persistent backend (optional) ─────────────────────────────────────────
// Uses the search_cache table from docs/migrations/001 if it exists. If the
// table is missing, all calls become no-ops and we fall back to memory. The
// public API is unchanged either way.

let persistentAvailable: boolean | null = null;

async function getServiceClient() {
  try {
    const mod = await import("@/lib/supabase/server");
    return mod.createServiceClient();
  } catch {
    return null;
  }
}

async function persistentGet<T>(key: string): Promise<T | null> {
  if (persistentAvailable === false) return null;
  const supabase = await getServiceClient();
  if (!supabase) {
    persistentAvailable = false;
    return null;
  }
  try {
    const { data, error } = await supabase
      .from("search_cache")
      .select("value, expires_at")
      .eq("key", key)
      .maybeSingle();
    if (error) {
      // Table likely doesn't exist yet — disable persistence for this process
      persistentAvailable = false;
      return null;
    }
    persistentAvailable = true;
    if (!data) return null;
    if (new Date(data.expires_at).getTime() < Date.now()) return null;
    return data.value as T;
  } catch {
    persistentAvailable = false;
    return null;
  }
}

async function persistentSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (persistentAvailable === false) return;
  const supabase = await getServiceClient();
  if (!supabase) return;
  try {
    await supabase
      .from("search_cache")
      .upsert({
        key,
        value: value as unknown as Record<string, unknown>,
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      });
  } catch {
    // non-fatal
  }
}

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
  // Also persist (best-effort, async, never blocks)
  void persistentSet(key, value, ttlSeconds);
}

// Async version that also checks the persistent table when memory misses.
export async function getCachedAsync<T>(key: string): Promise<T | null> {
  const mem = cache.get<T>(key);
  if (mem !== null) return mem;
  const persisted = await persistentGet<T>(key);
  if (persisted !== null) {
    // Re-warm the in-memory cache for the rest of this Lambda lifetime
    cache.set(key, persisted, 5 * 60);
    return persisted;
  }
  return null;
}

export function cacheStats() {
  return { ...cache.stats(), persistent: persistentAvailable };
}
