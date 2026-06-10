/**
 * Quotas du plan Free Supabase et calculs de seuils d'alerte.
 *
 * Les quotas sont des constantes produit (susceptibles d'évoluer côté
 * Supabase) : ils sont surchargeables dans les Réglages de l'app.
 */

export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;

export type MetricKind = 'egress' | 'dbSize' | 'mau' | 'storage';

export const METRIC_KINDS: readonly MetricKind[] = [
  'egress',
  'dbSize',
  'mau',
  'storage',
];

/** Quotas Free Plan (juin 2026) : 5 GB egress, 500 MB DB, 50k MAU, 1 GB storage. */
export const FREE_PLAN_QUOTAS: Record<MetricKind, number> = {
  egress: 5 * GB,
  dbSize: 500 * MB,
  mau: 50_000,
  storage: 1 * GB,
};

export const METRIC_LABELS: Record<MetricKind, string> = {
  egress: 'Egress',
  dbSize: 'Database size',
  mau: 'Monthly active users',
  storage: 'File storage',
};

/** Les métriques « octets » se formatent différemment des compteurs. */
export function isByteMetric(kind: MetricKind): boolean {
  return kind !== 'mau';
}

/**
 * Provenance d'une valeur :
 * - measured     : mesurée via un endpoint documenté ;
 * - estimated    : approximée (ex. MAU ≈ connexions du mois via SQL) ;
 * - stale        : dernière valeur connue (projet en pause / hors ligne) ;
 * - unavailable  : aucune source documentée — jamais de valeur inventée.
 */
export type MetricState = 'measured' | 'estimated' | 'stale' | 'unavailable';

export interface MetricValue {
  kind: MetricKind;
  state: MetricState;
  /** null tant que la métrique est indisponible. */
  value: number | null;
  quota: number;
  /** ISO 8601 — date de la mesure d'origine (≠ date de synchro). */
  measuredAt: string | null;
}

export function unavailableMetric(kind: MetricKind): MetricValue {
  return {
    kind,
    state: 'unavailable',
    value: null,
    quota: FREE_PLAN_QUOTAS[kind],
    measuredAt: null,
  };
}

/** Seuils d'alerte en pourcentage d'usage (configurables). */
export interface AlertThresholds {
  warn: number;
  high: number;
  critical: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  warn: 70,
  high: 85,
  critical: 95,
};

export type QuotaLevel = 'ok' | 'warn' | 'high' | 'critical';

/** Ratio d'usage 0..n (peut dépasser 1), null si indisponible. */
export function usageRatio(metric: MetricValue): number | null {
  if (metric.value === null || metric.quota <= 0) return null;
  return metric.value / metric.quota;
}

export function quotaLevel(
  metric: MetricValue,
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS
): QuotaLevel | null {
  const ratio = usageRatio(metric);
  if (ratio === null) return null;
  const pct = ratio * 100;
  if (pct >= thresholds.critical) return 'critical';
  if (pct >= thresholds.high) return 'high';
  if (pct >= thresholds.warn) return 'warn';
  return 'ok';
}

const LEVEL_ORDER: Record<QuotaLevel, number> = {
  ok: 0,
  warn: 1,
  high: 2,
  critical: 3,
};

/** Pire niveau d'un ensemble de métriques (null si aucune n'est mesurable). */
export function worstLevel(
  metrics: readonly MetricValue[],
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS
): QuotaLevel | null {
  let worst: QuotaLevel | null = null;
  for (const m of metrics) {
    const level = quotaLevel(m, thresholds);
    if (level === null) continue;
    if (worst === null || LEVEL_ORDER[level] > LEVEL_ORDER[worst]) {
      worst = level;
    }
  }
  return worst;
}

/**
 * Agrège des métriques de même nature (somme des valeurs, quota inchangé —
 * les quotas Free s'appliquent par projet/organisation, l'agrégat sert de
 * vue d'ensemble). L'état retenu est le plus faible niveau de confiance.
 */
export function sumMetrics(
  kind: MetricKind,
  metrics: readonly MetricValue[]
): MetricValue {
  const usable = metrics.filter(m => m.kind === kind && m.value !== null);
  if (usable.length === 0) return unavailableMetric(kind);
  const STATE_WEAKNESS: Record<MetricState, number> = {
    measured: 0,
    estimated: 1,
    stale: 2,
    unavailable: 3,
  };
  let state: MetricState = 'measured';
  let value = 0;
  let measuredAt: string | null = null;
  for (const m of usable) {
    value += m.value ?? 0;
    if (STATE_WEAKNESS[m.state] > STATE_WEAKNESS[state]) state = m.state;
    if (m.measuredAt && (!measuredAt || m.measuredAt < measuredAt)) {
      measuredAt = m.measuredAt; // la plus ancienne : honnête sur la fraîcheur
    }
  }
  return { kind, state, value, quota: FREE_PLAN_QUOTAS[kind], measuredAt };
}
