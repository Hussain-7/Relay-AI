import { getRedis } from "@/lib/redis";

/**
 * Get a cached value from Redis, falling back to the fetcher if not cached.
 * Returns fetcher result directly if Redis is not configured.
 */
export async function getCached<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (!redis) return fetcher();

  try {
    const cached = await redis.get<T>(key);
    if (cached !== null && cached !== undefined) return cached;
  } catch {
    // Redis read failed — fall through to fetcher
  }

  const value = await fetcher();

  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
  } catch {
    // Redis write failed — value still returned from fetcher
  }

  return value;
}

/**
 * Invalidate one or more cache keys. No-op if Redis is not configured.
 */
export async function invalidateCache(...keys: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis || keys.length === 0) return;

  try {
    await redis.del(...keys);
  } catch {
    // Swallow — cache invalidation is best-effort
  }
}
