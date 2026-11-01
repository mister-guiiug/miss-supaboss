/**
 * Historique court de métriques en localStorage (ring buffer) pour sparklines
 * — pas de BDD cloud ; purement appareil.
 */
import type { MetricKind } from '../../shared/quotas.ts';

const KEY = 'miss-supaboss-metric-history-v1';
const MAX_POINTS = 24;

export interface MetricPoint {
  at: string;
  value: number;
}

type HistoryMap = Record<string, Partial<Record<MetricKind, MetricPoint[]>>>;

function projectKey(accountId: string, ref: string): string {
  return `${accountId}:${ref}`;
}

function load(): HistoryMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryMap) : {};
  } catch {
    return {};
  }
}

function save(map: HistoryMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // quota storage : on abandonne silencieusement
  }
}

export const metricHistory = {
  record(
    accountId: string,
    ref: string,
    kind: MetricKind,
    value: number | null
  ): void {
    if (value === null || !Number.isFinite(value)) return;
    const map = load();
    const pk = projectKey(accountId, ref);
    const entry = map[pk] ?? {};
    const series = [...(entry[kind] ?? [])];
    series.push({ at: new Date().toISOString(), value });
    entry[kind] = series.slice(-MAX_POINTS);
    map[pk] = entry;
    save(map);
  },

  series(
    accountId: string,
    ref: string,
    kind: MetricKind
  ): readonly MetricPoint[] {
    return load()[projectKey(accountId, ref)]?.[kind] ?? [];
  },
};
