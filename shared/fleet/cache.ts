/** TTL cache flotte (aligné serveur / local-first / mock). */
export const FLEET_TTL_MS = 15_000;

/** TTL cache métriques Free Plan. */
export const METRICS_TTL_MS = 5 * 60_000;

/** Entrée de cache horodatée (Map par compte ou projet). */
export interface TimestampedCache<T> {
  value: T;
  at: number;
}

export function isCacheFresh(
  cachedAt: number,
  ttlMs: number,
  now: number = Date.now()
): boolean {
  return now - cachedAt < ttlMs;
}

export function readFleetCache<T>(
  cache: TimestampedCache<T> | undefined,
  refresh: boolean,
  ttlMs: number = FLEET_TTL_MS
): T | null {
  if (refresh || !cache) return null;
  return isCacheFresh(cache.at, ttlMs) ? cache.value : null;
}
