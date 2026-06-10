import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, PartyPopper } from 'lucide-react';
import type { RestoreAssessmentDto } from '../../../shared/contracts.ts';
import { isRestoreWindowExpired } from '../../../shared/guards.ts';
import { worstLevel } from '../../../shared/quotas.ts';
import { api, ApiError } from '../../api/index.ts';
import {
  findProject,
  metricsOf,
  useFleetStore,
} from '../../store/useFleetStore.ts';
import { toast } from '../../store/useUiStore.ts';
import { StatusBadge } from '../../shared/components/StatusBadge.tsx';
import { EmptyState } from '../../shared/components/EmptyState.tsx';
import { Skeleton } from '../../shared/components/Skeleton.tsx';
import { usePolling } from '../../shared/hooks/usePolling.ts';
import { useOnline } from '../../shared/hooks/useOnline.ts';

type Phase = 'check' | 'plan' | 'launching' | 'waiting' | 'ready' | 'failed';

export function PrepareDemoScreen() {
  const { accountId = '', ref = '' } = useParams();
  const fleet = useFleetStore(s => s.fleet);
  const metrics = useFleetStore(s => s.metrics);
  const settings = useFleetStore(s => s.settings);
  const loadFleet = useFleetStore(s => s.loadFleet);
  const restore = useFleetStore(s => s.restore);
  const online = useOnline();

  const project = useMemo(
    () => findProject(fleet, accountId, ref),
    [fleet, accountId, ref]
  );
  const projectMetrics = useMemo(
    () => metricsOf(metrics, accountId, ref),
    [metrics, accountId, ref]
  );

  const [phase, setPhase] = useState<Phase>('check');
  const [assessment, setAssessment] = useState<RestoreAssessmentDto | null>(
    null
  );
  const [selectedPauses, setSelectedPauses] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Étape 1 — vérifier capacité (slots actifs) et restaurabilité.
  useEffect(() => {
    if (phase !== 'check') return;
    let cancelled = false;
    void (async () => {
      try {
        const a = await api.assessRestore(accountId, ref);
        if (cancelled) return;
        setAssessment(a);
        setSelectedPauses(a.suggestions.map(s => s.ref));
        setPhase('plan');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Vérification impossible');
        setPhase('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, accountId, ref]);

  // Étape 4 — l'issue est DÉRIVÉE du statut observé (pas de setState
  // dans un effect) : 'waiting' devient 'ready' ou 'failed' au rendu.
  const restoreFailed =
    project?.status === 'RESTORE_FAILED' || project?.status === 'INIT_FAILED';
  const displayPhase: Phase =
    phase === 'waiting'
      ? project?.status === 'ACTIVE_HEALTHY'
        ? 'ready'
        : restoreFailed
          ? 'failed'
          : 'waiting'
      : phase;
  const displayError =
    error ??
    (displayPhase === 'failed'
      ? 'La restauration a échoué côté Supabase — réessayez ou consultez le dashboard Supabase.'
      : null);

  // Polling 5 s jusqu'à l'état actif.
  usePolling(
    () => void loadFleet(true),
    5_000,
    displayPhase === 'waiting' && online
  );

  const launch = useCallback(async () => {
    if (!assessment) return;
    setPhase('launching');
    try {
      await restore(accountId, ref, {
        pauseFirst: selectedPauses,
        force: !assessment.allowed && selectedPauses.length === 0,
      });
      setPhase('waiting');
    } catch (e) {
      if (e instanceof ApiError && e.assessment) {
        // Garde-fou serveur : re-propose les pauses à jour.
        setAssessment(e.assessment);
        setSelectedPauses(e.assessment.suggestions.map(s => s.ref));
        setPhase('plan');
        toast.error(e.message);
        return;
      }
      setError(e instanceof ApiError ? e.message : 'Restauration impossible');
      setPhase('failed');
    }
  }, [assessment, accountId, ref, selectedPauses, restore]);

  if (!project) {
    return (
      <EmptyState emoji="🤷" title="Projet introuvable">
        <Link to="/projects" className="font-medium text-primary">
          ← Retour aux projets
        </Link>
      </EmptyState>
    );
  }

  const quotaLevelWorst = worstLevel(projectMetrics, settings.thresholds);
  const windowExpired = isRestoreWindowExpired(project.meta.restoreDeadline);
  const needsPauses =
    assessment !== null &&
    !assessment.allowed &&
    assessment.reason === 'limit-reached';

  const steps = [
    { id: 'capacity', label: 'Vérifier quotas et capacité' },
    { id: 'plan', label: 'Libérer un slot si nécessaire' },
    { id: 'restore', label: 'Lancer la restauration' },
    { id: 'follow', label: 'Suivre la progression' },
    { id: 'ready', label: 'Projet prêt à présenter' },
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
    <div className="space-y-4">
      <Link
        to={`/projects/${accountId}/${ref}`}
        className="flex items-center gap-1 text-sm font-medium text-[var(--sb-text-soft)]"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {project.name}
      </Link>

      <header className="card flex items-center justify-between gap-2 p-4">
        <div>
          <h1 className="text-lg font-bold">🎬 Préparer la démo</h1>
          <p className="text-xs text-[var(--sb-text-soft)]">{project.name}</p>
        </div>
        <StatusBadge status={project.status} />
      </header>

      {/* Fil d'étapes. */}
      <ol className="card space-y-2 p-4" aria-label="Étapes">
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
          aria-label="Vérification"
        >
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}

      {displayPhase === 'plan' && assessment && (
        <section className="card space-y-3 p-4">
          <p className="text-sm">
            Compte :{' '}
            <strong className="tnum">
              {assessment.activeCount}/{assessment.limit}
            </strong>{' '}
            projets actifs.{' '}
            {needsPauses
              ? 'Limite Free atteinte — libérez un slot :'
              : 'Un slot est disponible ✔'}
          </p>
          {quotaLevelWorst === 'critical' && (
            <p className="rounded-lg bg-[var(--sb-critical)]/10 p-2 text-sm text-[var(--sb-critical)]">
              ⚠ Un quota est en zone critique sur ce projet — la démo peut être
              dégradée (voir l'écran Quotas).
            </p>
          )}
          {windowExpired && (
            <p className="rounded-lg bg-[var(--sb-warn)]/10 p-2 text-sm text-[var(--sb-warn)]">
              ⚠ Fenêtre de restauration estimée dépassée : la restauration
              directe peut être refusée par Supabase.
            </p>
          )}
          {needsPauses && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Projets à mettre en pause d'abord (suggestion automatique) :
              </legend>
              {assessment.suggestions.map(s => (
                <label
                  key={s.ref}
                  className="flex items-center gap-2 rounded-xl border border-[var(--sb-border)] p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedPauses.includes(s.ref)}
                    onChange={e =>
                      setSelectedPauses(prev =>
                        e.target.checked
                          ? [...prev, s.ref]
                          : prev.filter(r => r !== s.ref)
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {s.name}
                  </span>
                  <StatusBadge status={s.status} />
                </label>
              ))}
              {selectedPauses.length === 0 && (
                <p className="text-xs text-[var(--sb-warn)]">
                  Aucune pause sélectionnée : la restauration forcera le
                  dépassement et risque d'être refusée par Supabase.
                </p>
              )}
            </fieldset>
          )}
          <button
            type="button"
            disabled={!online}
            onClick={() => void launch()}
            className="touch-target w-full rounded-xl bg-primary px-4 font-semibold text-[#06281a] disabled:opacity-50"
          >
            {needsPauses && selectedPauses.length > 0
              ? `Suspendre ${selectedPauses.length} projet(s) puis restaurer`
              : 'Lancer la restauration'}
          </button>
        </section>
      )}

      {(displayPhase === 'launching' || displayPhase === 'waiting') && (
        <section className="card space-y-2 p-4" role="status">
          <p className="sb-pulse text-sm font-medium">
            {displayPhase === 'launching'
              ? 'Envoi de la demande à Supabase…'
              : 'Restauration en cours — généralement 1 à 3 minutes…'}
          </p>
          <p className="text-xs text-[var(--sb-text-soft)]">
            Vous pouvez quitter cet écran : le statut continue d'être suivi
            depuis le tableau de bord.
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
          <h2 className="text-lg font-bold">Projet prêt à présenter !</h2>
          <p className="text-sm text-[var(--sb-text-soft)]">
            « {project.name} » est actif et sain. Bonne démo 🎉
          </p>
          <Link
            to={`/projects/${accountId}/${ref}`}
            className="touch-target flex items-center justify-center rounded-xl border border-[var(--sb-border)] px-4 font-semibold"
          >
            Voir le projet
          </Link>
        </section>
      )}

      {displayPhase === 'failed' && (
        <section className="card space-y-3 p-4">
          <p className="text-sm text-[var(--sb-critical)]">⚠ {displayError}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setPhase('check');
            }}
            className="touch-target w-full rounded-xl border border-[var(--sb-border)] px-4 font-semibold"
          >
            Réessayer la vérification
          </button>
        </section>
      )}
    </div>
  );
}
