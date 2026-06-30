import { estimateRestoreDeadline } from '../guards.ts';
import { countsTowardActiveLimit } from '../status.ts';
import type { SupabaseProjectStatus } from '../status.ts';

/** Observations de statut persistées (serveur SQLite, localStorage). */
export interface ProjectObservation {
  lastSeenActiveAt: string | null;
  pausedAt: string | null;
  lastStatus: SupabaseProjectStatus;
}

export interface UserProjectMeta {
  tags: string[];
  favorite: boolean;
  demoFrequent: boolean;
  notes: string;
}

export interface ProjectMetaFields extends UserProjectMeta {
  lastSeenActiveAt: string | null;
  pausedAt: string | null;
  restoreDeadline: string | null;
}

/**
 * Met à jour les observations temporelles selon le statut live Supabase.
 * Logique identique à `Store.observeProject` (serveur) — source unique.
 */
export function observeStatusTransition(
  existing: ProjectObservation | null,
  status: SupabaseProjectStatus,
  now: string = new Date().toISOString()
): ProjectObservation {
  if (!existing) {
    const active = countsTowardActiveLimit(status);
    return {
      lastSeenActiveAt: active ? now : null,
      pausedAt: null,
      lastStatus: status,
    };
  }

  let { lastSeenActiveAt, pausedAt } = existing;
  if (countsTowardActiveLimit(status)) {
    lastSeenActiveAt = now;
    pausedAt = null;
  } else if (
    status === 'INACTIVE' &&
    existing.lastStatus !== 'INACTIVE' &&
    pausedAt === null
  ) {
    pausedAt = countsTowardActiveLimit(existing.lastStatus) ? now : null;
  }

  return { lastSeenActiveAt, pausedAt, lastStatus: status };
}

/** Fusionne méta utilisateur + observations + échéance de restauration. */
export function buildProjectMeta(
  userMeta: UserProjectMeta,
  observation: Pick<ProjectObservation, 'lastSeenActiveAt' | 'pausedAt'>,
  restoreWindowDays: number
): ProjectMetaFields {
  return {
    ...userMeta,
    lastSeenActiveAt: observation.lastSeenActiveAt,
    pausedAt: observation.pausedAt,
    restoreDeadline: estimateRestoreDeadline(
      observation.pausedAt,
      restoreWindowDays
    ),
  };
}
