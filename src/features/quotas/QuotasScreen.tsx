import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFleetStore } from '../../store/useFleetStore.ts';
import {
  METRIC_KINDS,
  sumMetrics,
  type MetricValue,
} from '../../../shared/quotas.ts';
import { formatRelative } from '../../../shared/format.ts';
import { QuotaBar } from '../../shared/components/QuotaBar.tsx';
import { ListSkeleton } from '../../shared/components/Skeleton.tsx';
import { EmptyState } from '../../shared/components/EmptyState.tsx';

/** Synthèse globale → détail par compte → détail par projet. */
export function QuotasScreen() {
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

  const globalSummary: MetricValue[] = useMemo(
    () =>
      METRIC_KINDS.map(kind =>
        sumMetrics(
          kind,
          byProject.flatMap(p => p.metrics)
        )
      ),
    [byProject]
  );

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

  if (!fleet) return <ListSkeleton count={3} />;
  if (!metrics && metricsLoading) return <ListSkeleton count={3} />;
  if (!metrics) {
    return (
      <EmptyState emoji="📊" title="Métriques pas encore collectées">
        <button
          type="button"
          onClick={() => void loadMetrics(true)}
          className="font-medium text-primary"
        >
          Collecter maintenant →
        </button>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--sb-text-soft)]">
          Synchro métriques {formatRelative(metrics.generatedAt)}
        </p>
        <button
          type="button"
          disabled={metricsLoading || fromCache}
          onClick={() => void loadMetrics(true)}
          className="rounded-full border border-[var(--sb-border)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {metricsLoading ? 'Collecte…' : 'Rafraîchir'}
        </button>
      </div>

      <section className="card space-y-3 p-4" aria-label="Synthèse globale">
        <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
          🌍 Synthèse multi-comptes (somme indicative)
        </h2>
        {globalSummary.map(m => (
          <QuotaBar key={m.kind} metric={m} thresholds={settings.thresholds} />
        ))}
        <p className="text-xs text-[var(--sb-text-soft)]">
          Les quotas Free s'appliquent par organisation : cette somme sert de
          vue d'ensemble, pas de calcul de facturation.
        </p>
      </section>

      {byAccount.map(({ account, summary }) => (
        <section
          key={account.id}
          className="card space-y-3 p-4"
          aria-label={`Quotas ${account.alias}`}
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

      <section className="space-y-2" aria-label="Détail par projet">
        <h2 className="px-1 text-sm font-semibold text-[var(--sb-text-soft)]">
          Détail par projet
        </h2>
        {byProject.map(({ account, project, metrics: pm }) => (
          <Link
            key={`${project.accountId}/${project.ref}`}
            to={`/projects/${project.accountId}/${project.ref}`}
            className="card block space-y-2.5 p-4"
          >
            <p className="flex items-center justify-between gap-2 text-sm font-semibold">
              <span className="truncate">{project.name}</span>
              <span className="shrink-0 text-xs font-normal text-[var(--sb-text-soft)]">
                {account.alias}
              </span>
            </p>
            {pm.length === 0 ? (
              <p className="text-xs text-[var(--sb-text-soft)]">
                Aucune mesure (projet jamais vu actif).
              </p>
            ) : (
              pm.map(m => (
                <QuotaBar
                  key={m.kind}
                  metric={m}
                  thresholds={settings.thresholds}
                />
              ))
            )}
          </Link>
        ))}
      </section>
    </div>
  );
}
