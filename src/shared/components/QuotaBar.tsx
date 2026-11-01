import {
  isByteMetric,
  METRIC_LABELS,
  quotaLevel,
  usageRatio,
  type AlertThresholds,
  type MetricValue,
} from '../../../shared/quotas.ts';
import { formatUsage } from '@mister-guiiug/dev-pwa-config/format';
import { formatPercent } from '../../../shared/format.ts';
import { useI18n } from '../../i18n/index.ts';
import { Sparkline } from './Sparkline.tsx';
import { metricHistory } from '../../api/metricHistory.ts';

const LEVEL_COLORS = {
  ok: 'var(--sb-ok)',
  warn: 'var(--sb-warn)',
  high: 'var(--sb-high)',
  critical: 'var(--sb-critical)',
} as const;

/** Jauge « Egress : 31 Mo / 5 Go » avec code couleur sobre par seuil. */
export function QuotaBar({
  metric,
  thresholds,
  accountId,
  projectRef,
}: {
  metric: MetricValue;
  thresholds: AlertThresholds;
  accountId?: string;
  projectRef?: string;
}) {
  const { t } = useI18n();
  const ratio = usageRatio(metric);
  const level = quotaLevel(metric, thresholds);
  const label = METRIC_LABELS[metric.kind];
  const usage = formatUsage(metric.value, metric.quota, {
    bytes: isByteMetric(metric.kind),
  });
  const hint =
    metric.state === 'measured'
      ? null
      : metric.state === 'estimated'
        ? t('quotas.hint.estimated')
        : metric.state === 'stale'
          ? t('quotas.hint.stale')
          : metric.kind === 'egress'
            ? t('quotas.hint.egressUnavailable')
            : t('quotas.hint.unavailable');
  const pct = ratio === null ? 0 : Math.min(ratio * 100, 100);
  const spark =
    accountId && projectRef
      ? metricHistory
          .series(accountId, projectRef, metric.kind)
          .map(p => p.value)
      : [];

  return (
    <div data-testid={`quota-${metric.kind}`} data-level={level ?? 'none'}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          {label}
          {spark.length >= 2 && (
            <Sparkline values={spark} className="text-primary" />
          )}
        </span>
        <span className="tnum text-[var(--sb-text-soft)]">
          {usage}
          {ratio !== null && (
            <span className="ml-1.5 text-xs">({formatPercent(ratio)})</span>
          )}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} : ${usage}${hint ? ` (${hint})` : ''}`}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(ratio !== null
          ? { 'aria-valuenow': Math.round(Math.min(ratio * 100, 100)) }
          : {})}
        className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--sb-surface-2)]"
      >
        {ratio !== null && (
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              minWidth: metric.value ? '0.35rem' : 0,
              background: LEVEL_COLORS[level ?? 'ok'],
            }}
          />
        )}
      </div>
      {hint && (
        <p className="mt-0.5 text-xs text-[var(--sb-text-soft)]">{hint}</p>
      )}
    </div>
  );
}
