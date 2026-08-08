/**
 * ratelimit.ts — a fixed-window attempt counter, in memory, no dependency.
 * One caller today: the credentials provider, keyed by email, so a leaked
 * password list cannot be replayed against one account at full speed.
 *
 * ponytail: the window lives in this process. Two App Runner instances means
 * two independent counters (effective ceiling = limit x instances) and a
 * deploy resets every one of them. The upgrade path is a shared store behind
 * this same two-function signature — Redis INCR+EXPIRE, or a Mongo collection
 * with a TTL index on `resetAt` — and nothing above it changes.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Ten tries a quarter hour: generous for a typo, useless for stuffing. */
export const AUTH_LIMIT = 10;
export const AUTH_WINDOW_MS = 15 * 60_000;

/** Counts the attempt. `true` = allowed, `false` = over the limit this window. */
export function allowAttempt(key: string, limit = AUTH_LIMIT, windowMs = AUTH_WINDOW_MS): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    // Sweep expired keys on insert rather than on a timer: an attacker cycling
    // through invented addresses cannot grow the map without bound.
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count++;
  return bucket.count <= limit;
}

/** A successful sign-in clears that account's window. No key = clear all. */
export function clearAttempts(key?: string): void {
  if (key === undefined) buckets.clear();
  else buckets.delete(key);
}
