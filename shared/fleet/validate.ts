import { isPausable, isRestorable } from '../status.ts';
import { assessRestore, toRestoreAssessmentDto } from './assessment.ts';
import type {
  FleetFailure,
  LiteProject,
  PauseTarget,
  RestoreOptions,
} from './types.ts';

export function validatePause(
  project: PauseTarget | undefined,
  ref: string
): FleetFailure | null {
  if (!project) {
    return {
      code: 'project-not-found',
      message: `Projet ${ref} introuvable`,
      status: 404,
    };
  }
  if (!isPausable(project.status)) {
    return {
      code: 'not-pausable',
      message: `« ${project.name} » n'est pas actif`,
      status: 409,
    };
  }
  return null;
}

/**
 * Valide une demande de restauration (garde-fous + statut cible).
 * Retourne null si la restauration peut être exécutée.
 */
export function validateRestore<P extends LiteProject>(
  projects: readonly P[],
  targetRef: string,
  options: RestoreOptions
): FleetFailure | null {
  const assessment = assessRestore(projects, targetRef, options.pauseFirst);

  if (!assessment.allowed && assessment.reason !== 'limit-reached') {
    return {
      code: assessment.reason,
      message: 'Restauration impossible',
      status: 409,
      assessment: toRestoreAssessmentDto(assessment),
    };
  }
  if (!assessment.allowed && !options.force) {
    return {
      code: 'limit-reached',
      message: `Limite Free atteinte (${assessment.activeCount}/${assessment.limit})`,
      status: 409,
      assessment: toRestoreAssessmentDto(assessment),
    };
  }

  const target = projects.find(p => p.ref === targetRef);
  if (!target || !isRestorable(target.status)) {
    return {
      code: 'not-restorable',
      message: `« ${target?.name ?? targetRef} » n'est pas en pause`,
      status: 409,
    };
  }
  return null;
}

/** Refs à mettre en pause avant restauration (hors cible, uniquement si pausables). */
export function pausesBeforeRestore<
  P extends { ref: string; status: PauseTarget['status'] },
>(
  projects: readonly P[],
  pauseFirst: readonly string[],
  targetRef: string
): string[] {
  return pauseFirst.filter(refToPause => {
    if (refToPause === targetRef) return false;
    const p = projects.find(x => x.ref === refToPause);
    return p !== undefined && isPausable(p.status);
  });
}
