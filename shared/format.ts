/** Formatage d'affichage (FR) — sans dépendance UI, utilisable côté serveur. */

/**
 * Octets → libellé court : 31 MB, 4.2 GB, 512 kB.
 * Unités SI binaires affichées façon dashboard Supabase (MB/GB).
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['kB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unit: string = 'B';
  for (const u of units) {
    value /= 1024;
    unit = u;
    if (value < 1024) break;
  }
  const rounded =
    value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${String(rounded).replace('.', ',')} ${unit}`;
}

/** Compteur → libellé compact : 2, 1,2k, 50k, 1,3M. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    const r = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
    return `${String(r).replace('.', ',')}k`;
  }
  const m = n / 1_000_000;
  const r = m >= 100 ? Math.round(m) : Math.round(m * 10) / 10;
  return `${String(r).replace('.', ',')}M`;
}

/** « 31 MB / 5 GB » ou « 2 / 50k » selon la nature de la métrique. */
export function formatUsage(
  value: number | null,
  quota: number,
  bytes: boolean
): string {
  const fmt = bytes ? formatBytes : formatCount;
  const left = value === null ? '—' : fmt(value);
  return `${left} / ${fmt(quota)}`;
}

export function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  const r = pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
  return `${String(r).replace('.', ',')} %`;
}

/** Date ISO → « il y a 3 min », « il y a 2 j », « à l'instant ». */
export function formatRelative(
  iso: string | null,
  now: Date = new Date()
): string {
  if (!iso) return 'jamais';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'jamais';
  const sec = Math.round((now.getTime() - t) / 1000);
  if (sec < 45) return 'à l’instant';
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 60) return `il y a ${d} j`;
  return new Date(t).toLocaleDateString('fr-FR');
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}
