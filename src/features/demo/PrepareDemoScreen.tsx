import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  FileQuestion,
  PartyPopper,
  TriangleAlert,
} from 'lucide-react';
import { isRestoreWindowExpired } from '../../../shared/guards.ts';
import { worstLevel } from '../../../shared/quotas.ts';
import { ApiError } from '../../api/index.ts';
import {
  findProject,
  metricsOf,
  useFleetStore,
} from '../../store/useFleetStore.ts';
import { toast } from '../../store/useUiStore.ts';
import { EmptyState } from '@mister-guiiug/dev-wpa-config/react/empty-state';
import { Skeleton } from '@mister-guiiug/dev-wpa-config/react/skeleton';
import { StatusBadge } from '../../shared/components/StatusBadge.tsx';
import { useActionGuard } from '../../shared/hooks/useActionGuard.ts';
import { usePolling } from '../../shared/hooks/usePolling.ts';
import { useAssessRestore } from '../../shared/queries/fleet.ts';
import { useI18n } from '../../i18n/index.ts';

type Phase = 'check' | 'plan' | 'launching' | 'waiting' | 'ready' | 'failed';

type UserPhase = 'assess' | 'launching' | 'waiting';

export function PrepareDemoScreen() {
  const { t } = useI18n();
  const { accountId = '', ref = '' } = useParams();
  const fleet = useFleetStore(s => s.fleet);
  const metrics = useFleetStore(s => s.metrics);
  const settings = useFleetStore(s => s.settings);
  const loadFleet = useFleetStore(s => s.loadFleet);
  const restore = useFleetStore(s => s.restore);
  const launchGuard = useActionGuard({
    online: true,
    operate: true,
    writable: true,
  });

  const project = useMemo(
    () => findProject(fleet, accountId, ref),
    [fleet, accountId, ref]
  );
  const projectMetrics = useMemo(
    () => metricsOf(metrics, accountId, ref),
    [metrics, accountId, ref]
  );

  const [userPhase, setUserPhase] = useState<UserPhase>('assess');
  const [selectedPauses, setSelectedPauses] = useState<string[] | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [assessKey, setAssessKey] = useState(0);

  const assessQ = useAssessRestore(
    accountId,
    ref,
    launchGuard.allowed && userPhase === 'assess'
  );

  const assessment = assessQ.data ?? null;
  const effectivePauses = useMemo(
    () => selectedPauses ?? assessment?.suggestions.map(s => s.ref) ?? [],
    [selectedPauses, assessment]
  );

  const restoreFailed =
    project?.status === 'RESTORE_FAILED' || project?.status === 'INIT_FAILED';

  const displayPhase: Phase = useMemo(() => {
    if (!launchGuard.allowed) return 'failed';
    if (userPhase === 'launching') return 'launching';
    if (userPhase === 'waiting') {
      if (project?.status === 'ACTIVE_HEALTHY') return 'ready';
      if (restoreFailed) return 'failed';
      return 'waiting';
    }
    if (launchError || assessQ.isError) return 'failed';
    if (assessQ.isLoading || assessQ.isFetching) return 'check';
    if (assessQ.isSuccess && assessment) return 'plan';
    return 'check';
  }, [
    launchGuard.allowed,
    userPhase,
    project?.status,
    restoreFailed,
    launchError,
    assessQ.isError,
    assessQ.isLoading,
    assessQ.isFetching,
    assessQ.isSuccess,
    assessment,
  ]);

  const displayError = useMemo(() => {
    if (launchError) return launchError;
    if (!launchGuard.allowed) return launchGuard.reason;
    if (assessQ.isError) {
      return assessQ.error instanceof ApiError
        ? assessQ.error.message
        : t('demo.assessFail');
    }
    if (displayPhase === 'failed' && userPhase === 'waiting') {
      return t('demo.restoreFailedServer');
    }
    return null;
  }, [
    launchError,
    launchGuard.allowed,
    launchGuard.reason,
    assessQ.isError,
    assessQ.error,
    displayPhase,
    userPhase,
    t,
  ]);

  usePolling(
    () => void loadFleet(true),
    5_000,
    displayPhase === 'waiting' && launchGuard.allowed
  );

  const launch = useCallback(async () => {
    if (!assessment || !launchGuard.allowed) return;
    setLaunchError(null);
    setUserPhase('launching');
    try {
      await restore(accountId, ref, {
        pauseFirst: effectivePauses,
        force: !assessment.allowed && effectivePauses.length === 0,
      });
      setUserPhase('waiting');
    } catch (e) {
      if (e instanceof ApiError && e.assessment) {
        setSelectedPauses(e.assessment.suggestions.map(s => s.ref));
        setUserPhase('assess');
        setAssessKey(k => k + 1);
        toast.error(e.message);
        return;
      }
      setLaunchError(e instanceof ApiError ? e.message : t('demo.restoreFail'));
      setUserPhase('assess');
    }
  }, [
    assessment,
    accountId,
    ref,
    effectivePauses,
    restore,
    launchGuard.allowed,
    t,
  ]);

  const retryAssess = useCallback(() => {
    setLaunchError(null);
    setSelectedPauses(null);
    setUserPhase('assess');
    setAssessKey(k => k + 1);
    void assessQ.refetch();
  }, [assessQ]);

  if (!project) {
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

  const quotaLevelWorst = worstLevel(projectMetrics, settings.thresholds);
  const windowExpired = isRestoreWindowExpired(project.meta.restoreDeadline);
  const needsPauses =
    assessment !== null &&
    !assessment.allowed &&
    assessment.reason === 'limit-reached';

  const steps = [
    { id: 'capacity', label: t('demo.step.capacity') },
    { id: 'plan', label: t('demo.step.plan') },
    { id: 'restore', label: t('demo.step.restore') },
    { id: 'follow', label: t('demo.step.follow') },
    { id: 'ready', label: t('demo.step.ready') },
  ];
  const currentStep =
    displayPhase === 'check'
      ? 0
      : displayPhase === 'plan'
        ? needsPauses
          ? 1
          : 2
        : displayPhase === 'launching'
          ? 2
          : displayPhase === 'waiting'
            ? 3
            : 4;

  return (
    <div className="space-y-4" key={assessKey}>
      <Link
        to={`/projects/${accountId}/${ref}`}
        className="flex items-center gap-1 text-sm font-medium text-[var(--sb-text-soft)]"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {project.name}
      </Link>

      <header className="card flex items-center justify-between gap-2 p-4">
        <div>
          <h1 className="flex items-center gap-1.5 text-lg font-bold">
            <Clapperboard size={18} aria-hidden="true" /> {t('demo.prepare')}
          </h1>
          <p className="text-xs text-[var(--sb-text-soft)]">{project.name}</p>
        </div>
        <StatusBadge status={project.status} />
      </header>

      <ol className="card space-y-2 p-4" aria-label={t('demo.stepsAria')}>
        {steps.map((s, i) => (
          <li
            key={s.id}
            className={`flex items-center gap-2 text-sm ${
              i < currentStep
                ? 'text-[var(--sb-ok)]'
                : i === currentStep
                  ? 'font-semibold'
                  : 'text-[var(--sb-text-soft)]'
            }`}
            aria-current={i === currentStep ? 'step' : undefined}
          >
            {i < currentStep ? (
              <CheckCircle2 size={16} aria-hidden="true" />
            ) : (
              <span
                aria-hidden="true"
                className={`flex size-4 items-center justify-center rounded-full border text-[0.6rem] ${
                  i === currentStep && displayPhase !== 'failed'
                    ? 'border-primary text-primary'
                    : 'border-[var(--sb-border)]'
                }`}
              >
                {i + 1}
              </span>
            )}
            {s.label}
          </li>
        ))}
      </ol>

      {displayPhase === 'check' && (
        <div
          className="card space-y-2 p-4"
          role="status"
          aria-label={t('demo.checkAria')}
        >
          <Skeleton width="66%" />
          <Skeleton width="50%" />
        </div>
      )}

      {displayPhase === 'plan' && assessment && (
        <section className="card space-y-3 p-4">
          <p className="text-sm">
            {t('demo.accountLabel')}{' '}
            <strong className="tnum">
              {assessment.activeCount}/{assessment.limit}
            </strong>{' '}
            {t('demo.activeProjects')}{' '}
            {needsPauses ? t('demo.limitReached') : t('demo.slotAvailable')}
          </p>
          {quotaLevelWorst === 'critical' && (
            <p className="flex items-start gap-1.5 rounded-lg bg-[var(--sb-critical)]/10 p-2 text-sm text-[var(--sb-critical)]">
              <TriangleAlert
                size={15}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              />
              <span>{t('demo.criticalQuota')}</span>
            </p>
          )}
          {windowExpired && (
            <p className="flex items-start gap-1.5 rounded-lg bg-[var(--sb-warn)]/10 p-2 text-sm text-[var(--sb-warn)]">
              <TriangleAlert
                size={15}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              />
              <span>{t('demo.windowExpired')}</span>
            </p>
          )}
          {needsPauses && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                {t('demo.pauseLegend')}
              </legend>
              {assessment.suggestions.map(s => (
                <label
                  key={s.ref}
                  className="flex items-center gap-2 rounded-xl border border-[var(--sb-border)] p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={effectivePauses.includes(s.ref)}
                    onChange={e =>
                      setSelectedPauses(prev => {
                        const base =
                          prev ?? assessment.suggestions.map(x => x.ref);
                        return e.target.checked
                          ? [...base, s.ref]
                          : base.filter(r => r !== s.ref);
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {s.name}
                  </span>
                  <StatusBadge status={s.status} />
                </label>
              ))}
              {effectivePauses.length === 0 && (
                <p className="text-xs text-[var(--sb-warn)]">
                  {t('demo.noPauseSelected')}
                </p>
              )}
            </fieldset>
          )}
          <button
            type="button"
            {...launchGuard.disabledProps}
            onClick={() => void launch()}
            className="touch-target w-full rounded-xl bg-primary px-4 font-semibold text-[#06281a] disabled:opacity-50"
          >
            {needsPauses && effectivePauses.length > 0
              ? t('demo.suspendAndRestore', { count: effectivePauses.length })
              : t('demo.launchRestore')}
          </button>
          {launchGuard.reason && (
            <p className="text-xs text-[var(--sb-warn)]">
              {launchGuard.reason}
            </p>
          )}
        </section>
      )}

      {(displayPhase === 'launching' || displayPhase === 'waiting') && (
        <section className="card space-y-2 p-4" role="status">
          <p className="sb-pulse text-sm font-medium">
            {displayPhase === 'launching'
              ? t('demo.sending')
              : t('demo.restoring')}
          </p>
          <p className="text-xs text-[var(--sb-text-soft)]">
            {t('demo.canLeave')}
          </p>
        </section>
      )}

      {displayPhase === 'ready' && (
        <section className="card space-y-3 p-4 text-center">
          <PartyPopper
            aria-hidden="true"
            className="mx-auto text-primary"
            size={36}
          />
          <h2 className="text-lg font-bold">{t('demo.readyTitle')}</h2>
          <p className="text-sm text-[var(--sb-text-soft)]">
            {t('demo.readyBody', { name: project.name })}
          </p>
          <Link
            to={`/projects/${accountId}/${ref}`}
            className="touch-target flex items-center justify-center rounded-xl border border-[var(--sb-border)] px-4 font-semibold"
          >
            {t('demo.viewProject')}
          </Link>
        </section>
      )}

      {displayPhase === 'failed' && (
        <section className="card space-y-3 p-4">
          <p className="flex items-start gap-1.5 text-sm text-[var(--sb-critical)]">
            <TriangleAlert
              size={15}
              aria-hidden="true"
              className="mt-0.5 shrink-0"
            />
            <span>{displayError}</span>
          </p>
          <button
            type="button"
            onClick={retryAssess}
            className="touch-target w-full rounded-xl border border-[var(--sb-border)] px-4 font-semibold"
          >
            {t('demo.retryCheck')}
          </button>
        </section>
      )}
    </div>
  );
}
