import type { ProjectDto, RestoreAssessmentDto } from '../contracts.ts';
import type { ProjectLite } from '../guards.ts';
import type { SupabaseProjectStatus } from '../status.ts';

/** Projet léger enrichi d'une référence DTO pour les suggestions UI. */
export type LiteProject<P extends ProjectDto = ProjectDto> = ProjectLite & {
  dto: P;
};

export interface RestoreOptions {
  pauseFirst: readonly string[];
  force: boolean;
}

export type FleetFailureCode =
  | 'not-pausable'
  | 'project-not-found'
  | 'not-restorable'
  | RestoreAssessmentDto['reason'];

/** Échec métier normalisé — mappé vers ApiError / FleetError côté adapters. */
export interface FleetFailure {
  code: FleetFailureCode;
  message: string;
  status: number;
  assessment?: RestoreAssessmentDto;
}

export type FleetResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: FleetFailure };

export function fleetOk<T>(value: T): FleetResult<T> {
  return { ok: true, value };
}

export function fleetFail(failure: FleetFailure): FleetResult<never> {
  return { ok: false, failure };
}

/** Projet minimal pour valider une pause. */
export interface PauseTarget {
  name: string;
  status: SupabaseProjectStatus;
}
