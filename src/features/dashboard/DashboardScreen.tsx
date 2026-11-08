import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PwaInstallPrompt } from '@mister-guiiug/dev-pwa-config/react/pwa-install-prompt';
import { AppFooter } from '@mister-guiiug/dev-pwa-config/react/app-footer';
import { repoUrl } from '@mister-guiiug/dev-pwa-config/apps-catalog';
import { APP_ID } from '../../appId.ts';
import { SatelliteDish, TriangleAlert } from 'lucide-react';
import {
  allProjects,
  metricsOf,
  useFleetStore,
} from '../../store/useFleetStore.ts';
import { isTransient, statusGroup } from '../../../shared/status.ts';
import {
  isByteMetric,
  METRIC_LABELS,
  quotaLevel,
  type MetricValue,
  type QuotaLevel,
} from '../../../shared/quotas.ts';
import { formatUsage } from '@mister-guiiug/dev-pwa-config/format';
import { formatRelative } from '../../../shared/format.ts';
import { EmptyState } from '@mister-guiiug/dev-pwa-config/react/empty-state';
import { ListSkeleton } from '../../shared/components/Skeleton.tsx';
import { StatusBadge } from '../../shared/components/StatusBadge.tsx';
import { usePolling } from '../../shared/hooks/usePolling.ts';
import { useOnline } from '@mister-guiiug/dev-pwa-config/react/use-online';
import { useI18n } from '../../i18n/index.ts';
import { api, IS_MOCK } from '../../api/index.ts';
import { daysUntilPatExpiry, PAT_EXPIRY_HORIZON_DAYS } from './patExpiry.ts';

const LEVEL_BADGE: Record<QuotaLevel, string> = {
  ok: 'text-[var(--sb-ok)]',
  warn: 'text-[var(--sb-warn)]',
  high: 'text-[var(--sb-high)]',
  critical: 'text-[var(--sb-critical)]',
};

export function DashboardScreen() {
  const { t } = useI18n();
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

  const expiringPats = useMemo(() => {
    if (!fleet) return [];
    return fleet.accounts.flatMap(({ account }) => {
      const days = daysUntilPatExpiry(account.patExpiresAt);
      if (days === null || days > PAT_EXPIRY_HORIZON_DAYS) return [];
      return [{ account, days }];
    });
  }, [fleet]);

  const modeKey = IS_MOCK
    ? 'dashboard.modeDemo'
    : api.schedules?.runsInBackground
      ? 'dashboard.modeServer'
      : 'dashboard.modeLocal';

  const running = useMemo(
    () =>
      projects
        .filter(p => statusGroup(p.status) === 'active')
        .sort((a, b) =>
          (b.meta.lastSeenActiveAt ?? '').localeCompare(
            a.meta.lastSeenActiveAt ?? ''
          )
        ),
    [projects]
  );
  const attention = useMemo(
    () =>
      projects.filter(p => {
        const group = statusGroup(p.status);
        return group === 'transition' || group === 'error';
      }),
    [projects]
  );

  const alerts = useMemo(() => {
    const out: {
      key: string;
      accountId: string;
      ref: string;
      name: string;
      metric: MetricValue;
      level: QuotaLevel;
    }[] = [];
    for (const p of projects) {
      for (const m of metricsOf(metrics, p.accountId, p.ref)) {
        const level = quotaLevel(m, settings.thresholds);
        if (level && level !== 'ok') {
          out.push({
            key: `${p.accountId}/${p.ref}/${m.kind}`,
            accountId: p.accountId,
            ref: p.ref,
            name: p.name,
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
      <EmptyState
        icon={<SatelliteDish size={40} strokeWidth={1.5} />}
        title={t('dashboard.emptyTitle')}
        description={t('dashboard.emptyBody')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-xs text-[var(--sb-text-soft)]">{t(modeKey)}</p>
      {expiringPats.length > 0 && (
        <section aria-label={t('dashboard.patExpiryAria')} className="card p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-warn)]">
            <TriangleAlert size={15} aria-hidden="true" />{' '}
            {t('dashboard.patExpiryAria')}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {expiringPats.map(({ account, days }) => (
              <li key={account.id}>
                <Link to="/accounts" className="underline">
                  {t(
                    days < 0 ? 'dashboard.patExpired' : 'dashboard.patExpires',
                    {
                      alias: account.alias,
                      date: account.patExpiresAt ?? '',
                    }
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {attention.length > 0 && (
        <section
          aria-label={t('dashboard.attentionTitle')}
          className="space-y-2"
        >
          <h2 className="px-1 text-sm font-semibold text-[var(--sb-text-soft)]">
            {t('dashboard.attentionTitle')}
          </h2>
          {attention.map(p => (
            <Link
              key={`state-${p.accountId}/${p.ref}`}
              to={`/projects/${p.accountId}/${p.ref}`}
              className="card flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <span className="min-w-0 truncate font-semibold">{p.name}</span>
              <StatusBadge status={p.status} />
            </Link>
          ))}
        </section>
      )}
      {alerts.length > 0 && (
        <section aria-label={t('dashboard.alertsAria')} className="space-y-2">
          <h2 className="px-1 text-sm font-semibold text-[var(--sb-text-soft)]">
            {t('dashboard.alertsTitle')}
          </h2>
          {alerts.map(a => (
            <Link
              key={a.key}
              to={`/projects/${a.accountId}/${a.ref}`}
              className="card block px-3 py-2.5"
            >
              <span className="block truncate font-semibold">{a.name}</span>
              <span
                className={`block truncate text-xs ${LEVEL_BADGE[a.level]}`}
              >
                {METRIC_LABELS[a.metric.kind]}{' '}
                {formatUsage(a.metric.value, a.metric.quota, {
                  bytes: isByteMetric(a.metric.kind),
                })}
              </span>
            </Link>
          ))}
        </section>
      )}
      <section aria-label={t('dashboard.activesAria')} className="space-y-2">
        {running.length === 0 ? (
          <p className="px-1 text-sm text-[var(--sb-text-soft)]">
            {t('dashboard.noActive')}
          </p>
        ) : (
          running.map(p => {
            const alias =
              fleet.accounts.find(a => a.account.id === p.accountId)?.account
                .alias ?? '';
            return (
              <Link
                key={`${p.accountId}/${p.ref}`}
                to={`/projects/${p.accountId}/${p.ref}`}
                className="card flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.name}</span>
                  {fleet.accounts.length > 1 && (
                    <span className="block truncate text-xs text-[var(--sb-text-soft)]">
                      {alias}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-[var(--sb-text-soft)]">
                  {formatRelative(p.meta.lastSeenActiveAt, {
                    never: t('common.never'),
                  })}
                </span>
              </Link>
            );
          })
        )}
      </section>
      <Link
        to="/quotas"
        className="inline-block text-sm font-semibold text-primary"
      >
        {t('dashboard.seeAllQuotas')}
      </Link>

      {/* SUR LE TABLEAU DE BORD, ET PAS DANS LA COQUILLE : un bandeau global
          paraîtrait par-dessus une pause ou une restauration de projet en
          cours ; ici l'utilisateur est au repos. Ne rend rien tant qu'une
          installation n'est pas possible, ni une fois l'application installée
          — et sur iOS, où l'événement natif n'existe pas, donne la marche à
          suivre. Cadence du socle : au premier lancement, puis une fois par
          mois, trois fois. */}
      <PwaInstallPrompt />

      {/* Le code source, le soutien et le signalement : ici et dans les
          Réglages, nulle part ailleurs (règle famille du 06/09/2026). */}
      <AppFooter
        version
        issues
        className="mt-8 justify-center"
        repoUrl={repoUrl(APP_ID)}
      />
    </div>
  );
}
