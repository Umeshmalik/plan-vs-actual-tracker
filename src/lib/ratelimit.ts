// A fixed-window attempt counter, in memory.
//
// ponytail: the window lives in THIS process, so N instances means N counters
// and a deploy resets them. Upgrade: a shared store (Redis INCR+EXPIRE) behind
// this same two-function signature.

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
    // Sweep on insert, not on a timer, so invented addresses cannot grow the map.
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
