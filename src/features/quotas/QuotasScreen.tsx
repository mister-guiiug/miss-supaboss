import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Gauge } from 'lucide-react';
import { useFleetStore } from '../../store/useFleetStore.ts';
import {
  isByteMetric,
  METRIC_KINDS,
  METRIC_LABELS,
  quotaLevel,
  sumMetrics,
  type QuotaLevel,
} from '../../../shared/quotas.ts';
import { formatUsage } from '@mister-guiiug/dev-pwa-config/format';
import { formatRelative } from '../../../shared/format.ts';
import { QuotaBar } from '../../shared/components/QuotaBar.tsx';
import { EmptyState } from '@mister-guiiug/dev-pwa-config/react/empty-state';
import { ListSkeleton } from '../../shared/components/Skeleton.tsx';
import { useI18n } from '../../i18n/index.ts';

/** Mesures au-dessus du seuil, puis les barres de chaque compte. */
export function QuotasScreen() {
  const { t } = useI18n();
  const fleet = useFleetStore(s => s.fleet);
  const metrics = useFleetStore(s => s.metrics);
  const settings = useFleetStore(s => s.settings);
  const metricsLoading = useFleetStore(s => s.metricsLoading);
  const loadMetrics = useFleetStore(s => s.loadMetrics);
  const fromCache = useFleetStore(s => s.fromCache);

  const byProject = useMemo(() => {
    if (!fleet || !metrics) return [];
    return fleet.accounts.flatMap(af =>
      af.projects.map(p => ({
        account: af.account,
        project: p,
        metrics:
          metrics.projects.find(
            m => m.accountId === p.accountId && m.ref === p.ref
          )?.metrics ?? [],
      }))
    );
  }, [fleet, metrics]);

  const byAccount = useMemo(() => {
    if (!fleet) return [];
    return fleet.accounts.map(af => ({
      account: af.account,
      summary: METRIC_KINDS.map(kind =>
        sumMetrics(
          kind,
          byProject
            .filter(p => p.account.id === af.account.id)
            .flatMap(p => p.metrics)
        )
      ),
    }));
  }, [fleet, byProject]);

  const hot = useMemo(() => {
    const order: Record<QuotaLevel, number> = {
      critical: 0,
      high: 1,
      warn: 2,
      ok: 3,
    };
    return byProject
      .flatMap(({ project, metrics: pm }) =>
        pm.flatMap(metric => {
          const level = quotaLevel(metric, settings.thresholds);
          if (!level || level === 'ok') return [];
          return [{ project, metric, level }];
        })
      )
      .sort((a, b) => order[a.level] - order[b.level]);
  }, [byProject, settings.thresholds]);

  if (!fleet) return <ListSkeleton count={3} />;
  if (!metrics && metricsLoading) return <ListSkeleton count={3} />;
  if (!metrics) {
    return (
      <EmptyState
        icon={<Gauge size={40} strokeWidth={1.5} />}
        title={t('quotas.emptyTitle')}
        action={
          <button
            type="button"
            onClick={() => void loadMetrics(true)}
            className="font-medium text-primary"
          >
            {t('quotas.collectNow')} →
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--sb-text-soft)]">
          {t('quotas.syncMetrics', {
            rel: formatRelative(metrics.generatedAt, {
              never: t('common.never'),
            }),
          })}
        </p>
        <button
          type="button"
          disabled={metricsLoading || fromCache}
          onClick={() => void loadMetrics(true)}
          className="rounded-full border border-[var(--sb-border)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {metricsLoading ? t('quotas.collecting') : t('quotas.refresh')}
        </button>
      </div>

      {hot.length > 0 && (
        <section className="space-y-2" aria-label={t('quotas.watchAria')}>
          <h2 className="px-1 text-sm font-semibold text-[var(--sb-text-soft)]">
            {t('quotas.watchTitle')}
          </h2>
          {hot.map(row => (
            <Link
              key={`${row.project.accountId}/${row.project.ref}/${row.metric.kind}`}
              to={`/projects/${row.project.accountId}/${row.project.ref}`}
              className="card block px-3 py-2.5"
            >
              <span className="block truncate text-sm font-semibold">
                {row.project.name}
              </span>
              <span className="block truncate text-xs text-[var(--sb-text-soft)]">
                {METRIC_LABELS[row.metric.kind]}{' '}
                {formatUsage(row.metric.value, row.metric.quota, {
                  bytes: isByteMetric(row.metric.kind),
                })}
              </span>
            </Link>
          ))}
        </section>
      )}

      {byAccount.map(({ account, summary }) => (
        <section
          key={account.id}
          className="card space-y-3 p-4"
          aria-label={t('quotas.accountAria', { alias: account.alias })}
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ background: account.color }}
            />
            {account.alias}
          </h2>
          {summary.map(m => (
            <QuotaBar
              key={m.kind}
              metric={m}
              thresholds={settings.thresholds}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
