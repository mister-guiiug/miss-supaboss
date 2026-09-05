import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileQuestion,
  PauseCircle,
  PlayCircle,
  Star,
  Zap,
} from 'lucide-react';
import {
  findProject,
  metricsOf,
  projectsOfAccount,
  useFleetStore,
} from '../../store/useFleetStore.ts';
import { useSessionStore } from '../../store/useSessionStore.ts';
import { toast } from '../../store/useUiStore.ts';
import { ApiError } from '../../api/index.ts';
import {
  isPausable,
  isRestorable,
  isTransient,
  statusGroup,
} from '../../../shared/status.ts';
import {
  ACTIVE_PROJECT_LIMIT,
  activeProjects,
  isRestoreWindowExpired,
} from '../../../shared/guards.ts';
import { formatDateTime, formatRelative } from '../../../shared/format.ts';
import { ConfirmDialog } from '@mister-guiiug/dev-pwa-config/react/confirm-dialog';
import { EmptyState } from '@mister-guiiug/dev-pwa-config/react/empty-state';
import { StatusBadge } from '../../shared/components/StatusBadge.tsx';
import { QuotaBar } from '../../shared/components/QuotaBar.tsx';
import { useActionGuard } from '../../shared/hooks/useActionGuard.ts';
import { usePolling } from '../../shared/hooks/usePolling.ts';
import { useOnline } from '@mister-guiiug/dev-pwa-config/react/use-online';
import { useI18n } from '../../i18n/index.ts';

const SUGGESTED_TAGS = ['poc', 'demo', 'archive', 'critique-demo'];

export function ProjectDetailScreen() {
  const { t } = useI18n();
  const { accountId = '', ref = '' } = useParams();
  const navigate = useNavigate();
  const fleet = useFleetStore(s => s.fleet);
  const metrics = useFleetStore(s => s.metrics);
  const settings = useFleetStore(s => s.settings);
  const loadFleet = useFleetStore(s => s.loadFleet);
  const pause = useFleetStore(s => s.pause);
  const updateMeta = useFleetStore(s => s.updateMeta);
  const user = useSessionStore(s => s.user);
  const online = useOnline();
  const actionGuard = useActionGuard({
    online: true,
    operate: true,
    writable: true,
  });
  const metaGuard = useActionGuard({ operate: true, writable: true });

  const project = useMemo(
    () => findProject(fleet, accountId, ref),
    [fleet, accountId, ref]
  );
  const account = useMemo(
    () =>
      fleet?.accounts.find(a => a.account.id === accountId)?.account ?? null,
    [fleet, accountId]
  );
  const accountProjects = useMemo(
    () => projectsOfAccount(fleet, accountId),
    [fleet, accountId]
  );
  const projectMetrics = useMemo(
    () => metricsOf(metrics, accountId, ref),
    [metrics, accountId, ref]
  );

  const transient = project ? isTransient(project.status) : false;
  usePolling(
    () => void loadFleet(true),
    5_000,
    transient && online && actionGuard.allowed
  );

  const [confirmPause, setConfirmPause] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!project || !account) {
    return (
      <EmptyState
        icon={<FileQuestion size={40} strokeWidth={1.5} />}
        title={t('projectDetail.notFound')}
        action={
          <Link to="/projects" className="font-medium text-primary">
            ← {t('projectDetail.backToProjects')}
          </Link>
        }
      />
    );
  }

  const actives = activeProjects(accountProjects);
  const windowExpired = isRestoreWindowExpired(project.meta.restoreDeadline);

  const doPause = async (): Promise<void> => {
    setBusy(true);
    try {
      await pause(accountId, ref);
      setConfirmPause(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t('projectDetail.pauseFail')
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleMeta = async (
    fields: Parameters<typeof updateMeta>[2]
  ): Promise<void> => {
    if (!metaGuard.allowed) return;
    try {
      await updateMeta(accountId, ref, fields);
    } catch {
      toast.error(t('projectDetail.metaFail'));
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm font-medium text-[var(--sb-text-soft)]"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {t('common.back')}
      </button>

      <section className="card space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{project.name}</h1>
            <p className="truncate text-xs text-[var(--sb-text-soft)]">
              {project.ref} · {project.organizationName} · {project.region}
            </p>
          </div>
          <StatusBadge status={project.status} />
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-[var(--sb-text-soft)]">
              {t('projectDetail.account')}
            </dt>
            <dd className="font-medium">{account.alias}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--sb-text-soft)]">
              {t('projectDetail.createdAt')}
            </dt>
            <dd className="font-medium">{formatDateTime(project.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--sb-text-soft)]">
              {t('projectDetail.lastActivity')}
            </dt>
            <dd className="font-medium">
              {formatRelative(project.meta.lastSeenActiveAt, {
                never: t('common.never'),
              })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--sb-text-soft)]">
              {t('projectDetail.pausedAt')}
            </dt>
            <dd className="font-medium">
              {project.meta.pausedAt
                ? formatDateTime(project.meta.pausedAt)
                : statusGroup(project.status) === 'paused'
                  ? t('projectDetail.unknownDate')
                  : '—'}
            </dd>
          </div>
          {project.meta.restoreDeadline && (
            <div className="col-span-2">
              <dt className="text-xs text-[var(--sb-text-soft)]">
                {t('projectDetail.restorableUntil')}
              </dt>
              <dd
                className={`font-medium ${windowExpired ? 'text-[var(--sb-critical)]' : ''}`}
              >
                {formatDateTime(project.meta.restoreDeadline)}
                {windowExpired && t('projectDetail.windowLikelyExpired')}
              </dd>
            </div>
          )}
        </dl>

        <div className="flex gap-2">
          {isPausable(project.status) && (
            <button
              type="button"
              disabled={!actionGuard.allowed || busy}
              onClick={() => setConfirmPause(true)}
              className="touch-target flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--sb-border)] px-4 font-semibold disabled:opacity-50"
            >
              <PauseCircle size={18} aria-hidden="true" />{' '}
              {t('projectDetail.pause')}
            </button>
          )}
          {isRestorable(project.status) && (
            <Link
              to={`/projects/${accountId}/${ref}/demo`}
              aria-disabled={!actionGuard.allowed}
              className={`touch-target flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-[#06281a] ${
                !actionGuard.allowed ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              <PlayCircle size={18} aria-hidden="true" /> {t('demo.prepare')}
            </Link>
          )}
        </div>
        {actionGuard.reasonCode === 'operate' && (
          <p className="text-xs text-[var(--sb-text-soft)]">
            {t('projectDetail.readOnlyRole', { role: user?.role ?? '' })}
          </p>
        )}
        {actionGuard.reason && actionGuard.reasonCode !== 'operate' && (
          <p className="text-xs text-[var(--sb-warn)]">{actionGuard.reason}</p>
        )}
      </section>

      <section
        className="card space-y-3 p-4"
        aria-label={t('projectDetail.markersAria')}
      >
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={project.meta.favorite}
            disabled={!metaGuard.allowed}
            onClick={() =>
              void toggleMeta({ favorite: !project.meta.favorite })
            }
            className={`touch-target flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-medium disabled:opacity-50 ${
              project.meta.favorite
                ? 'border-[var(--sb-warn)] text-[var(--sb-warn)]'
                : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
            }`}
          >
            <Star size={16} aria-hidden="true" /> {t('common.favorite')}
          </button>
          <button
            type="button"
            aria-pressed={project.meta.demoFrequent}
            disabled={!metaGuard.allowed}
            onClick={() =>
              void toggleMeta({ demoFrequent: !project.meta.demoFrequent })
            }
            className={`touch-target flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-medium disabled:opacity-50 ${
              project.meta.demoFrequent
                ? 'border-primary text-primary'
                : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
            }`}
          >
            <Zap size={16} aria-hidden="true" /> {t('common.demoFrequent')}
          </button>
        </div>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t('projectDetail.tagsAria')}
        >
          {SUGGESTED_TAGS.map(tag => {
            const active = project.meta.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={active}
                disabled={!metaGuard.allowed}
                onClick={() =>
                  void toggleMeta({
                    tags: active
                      ? project.meta.tags.filter(t => t !== tag)
                      : [...project.meta.tags, tag],
                  })
                }
                className={`rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                  active
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card space-y-3 p-4" aria-label={t('titles.quotas')}>
        <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
          {t('titles.quotas')}
        </h2>
        {projectMetrics.length === 0 ? (
          <p className="text-sm text-[var(--sb-text-soft)]">
            {t('projectDetail.noMetrics')}
          </p>
        ) : (
          projectMetrics.map(m => (
            <QuotaBar
              key={m.kind}
              metric={m}
              thresholds={settings.thresholds}
            />
          ))
        )}
      </section>

      <ConfirmDialog
        open={confirmPause}
        title={t('projectDetail.pauseTitle', { name: project.name })}
        confirmLabel={t('projectDetail.pause')}
        loading={busy}
        onCancel={() => setConfirmPause(false)}
        onConfirm={() => void doPause()}
      >
        <p>
          {t('projectDetail.pauseBody', {
            alias: account.alias,
            active: actives.length,
            limit: ACTIVE_PROJECT_LIMIT,
          })}
        </p>
      </ConfirmDialog>
    </div>
  );
}
