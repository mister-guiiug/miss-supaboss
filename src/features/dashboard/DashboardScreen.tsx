import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  Clapperboard,
  PlayCircle,
  SatelliteDish,
  Siren,
  TriangleAlert,
  UsersRound,
} from 'lucide-react';
import {
  allProjects,
  metricsOf,
  useFleetStore,
} from '../../store/useFleetStore.ts';
import {
  ACTIVE_PROJECT_LIMIT,
  activeProjects,
} from '../../../shared/guards.ts';
import { isRestorable, isTransient } from '../../../shared/status.ts';
import {
  quotaLevel,
  type MetricValue,
  type QuotaLevel,
} from '../../../shared/quotas.ts';
import { formatRelative, formatUsage } from '../../../shared/format.ts';
import { isByteMetric, METRIC_LABELS } from '../../../shared/quotas.ts';
import { ListSkeleton } from '../../shared/components/Skeleton.tsx';
import { EmptyState } from '../../shared/components/EmptyState.tsx';
import { StatusBadge } from '../../shared/components/StatusBadge.tsx';
import { usePolling } from '../../shared/hooks/usePolling.ts';
import { useOnline } from '../../shared/hooks/useOnline.ts';

const LEVEL_BADGE: Record<QuotaLevel, string> = {
  ok: 'text-[var(--sb-ok)]',
  warn: 'text-[var(--sb-warn)]',
  high: 'text-[var(--sb-high)]',
  critical: 'text-[var(--sb-critical)]',
};

export function DashboardScreen() {
  const fleet = useFleetStore(s => s.fleet);
  const metrics = useFleetStore(s => s.metrics);
  const settings = useFleetStore(s => s.settings);
  const loading = useFleetStore(s => s.loading);
  const fromCache = useFleetStore(s => s.fromCache);
  const loadFleet = useFleetStore(s => s.loadFleet);
  const online = useOnline();

  const projects = useMemo(() => allProjects(fleet), [fleet]);
  const hasTransient = useMemo(
    () => projects.some(p => isTransient(p.status)),
    [projects]
  );
  // Polling : cadence réglée, resserrée à 5 s pendant une transition.
  usePolling(
    () => void loadFleet(true),
    hasTransient ? 5_000 : settings.pollingSeconds * 1000,
    online && !fromCache && projects.length > 0
  );

  const readyToStart = useMemo(
    () =>
      projects.filter(
        p => isRestorable(p.status) && (p.meta.favorite || p.meta.demoFrequent)
      ),
    [projects]
  );

  const alerts = useMemo(() => {
    const out: {
      key: string;
      label: string;
      metric: MetricValue;
      level: QuotaLevel;
    }[] = [];
    for (const p of projects) {
      for (const m of metricsOf(metrics, p.accountId, p.ref)) {
        const level = quotaLevel(m, settings.thresholds);
        if (level && level !== 'ok') {
          out.push({
            key: `${p.accountId}/${p.ref}/${m.kind}`,
            label: `${p.name} — ${METRIC_LABELS[m.kind]}`,
            metric: m,
            level,
          });
        }
      }
    }
    const order: Record<QuotaLevel, number> = {
      critical: 0,
      high: 1,
      warn: 2,
      ok: 3,
    };
    return out.sort((a, b) => order[a.level] - order[b.level]).slice(0, 5);
  }, [projects, metrics, settings.thresholds]);

  if (!fleet && loading) return <ListSkeleton count={3} />;
  if (!fleet) {
    return (
      <EmptyState icon={SatelliteDish} title="Aucune donnée">
        Vérifiez la connexion au serveur puis rafraîchissez.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      {/* Comptes : slots actifs / limite Free + état de synchro. En-tête
          explicite (+ « Gérer ») pour que la section ne soit plus prise pour des
          projets et que l'accès à la gestion des comptes soit nommé. */}
      <section aria-label="Comptes" className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
            <UsersRound size={15} aria-hidden="true" /> Comptes
          </h2>
          <Link to="/accounts" className="text-sm font-medium text-primary">
            Gérer →
          </Link>
        </div>
        {fleet.accounts.map(
          ({ account, projects: accountProjects, syncedAt }) => {
            const actives = activeProjects(accountProjects);
            const full = actives.length >= ACTIVE_PROJECT_LIMIT;
            return (
              <Link
                key={account.id}
                to="/accounts"
                className="card flex items-center gap-3 p-4"
              >
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ background: account.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{account.alias}</p>
                  {!account.enabled ? (
                    <p className="truncate text-xs text-[var(--sb-text-soft)]">
                      Compte Supabase · désactivé
                    </p>
                  ) : account.lastError ? (
                    <p className="flex items-center gap-1 text-xs text-[var(--sb-critical)]">
                      <TriangleAlert
                        size={12}
                        aria-hidden="true"
                        className="shrink-0"
                      />
                      <span className="truncate">{account.lastError}</span>
                    </p>
                  ) : (
                    <p className="truncate text-xs text-[var(--sb-text-soft)]">
                      Compte Supabase · synchro {formatRelative(syncedAt)}
                    </p>
                  )}
                </div>
                <span
                  className={`tnum rounded-full px-2.5 py-1 text-sm font-bold ${
                    full
                      ? 'bg-[var(--sb-warn)]/15 text-[var(--sb-warn)]'
                      : 'bg-[var(--sb-ok)]/15 text-[var(--sb-ok)]'
                  }`}
                >
                  {actives.length}/{ACTIVE_PROJECT_LIMIT} actifs
                </span>
                <ChevronRight
                  size={16}
                  aria-hidden="true"
                  className="text-[var(--sb-text-soft)]"
                />
              </Link>
            );
          }
        )}
      </section>

      {/* Ce que je peux démarrer maintenant. */}
      {readyToStart.length > 0 && (
        <section aria-label="Prêts à présenter" className="card p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
            <Clapperboard size={15} aria-hidden="true" /> Prêts à démarrer
            maintenant
          </h2>
          <ul className="mt-2 space-y-2">
            {readyToStart.map(p => (
              <li key={`${p.accountId}/${p.ref}`}>
                <Link
                  to={`/projects/${p.accountId}/${p.ref}/demo`}
                  className="flex items-center gap-2 rounded-xl border border-[var(--sb-border)] p-3"
                >
                  <PlayCircle
                    size={20}
                    aria-hidden="true"
                    className="text-primary"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {p.name}
                  </span>
                  <StatusBadge status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Quotas proches du seuil. */}
      {alerts.length > 0 && (
        <section aria-label="Alertes quotas" className="card p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
            <Siren size={15} aria-hidden="true" /> Quotas proches du seuil
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {alerts.map(a => (
              <li
                key={a.key}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate">{a.label}</span>
                <span className={`tnum font-semibold ${LEVEL_BADGE[a.level]}`}>
                  {formatUsage(
                    a.metric.value,
                    a.metric.quota,
                    isByteMetric(a.metric.kind)
                  )}
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/quotas"
            className="mt-2 inline-block text-sm font-medium text-primary"
          >
            Voir tous les quotas →
          </Link>
        </section>
      )}
    </div>
  );
}
