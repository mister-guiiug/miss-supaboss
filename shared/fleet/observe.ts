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
  keepAliveOptIn?: boolean;
}

export interface ProjectMetaFields extends UserProjectMeta {
  lastSeenActiveAt: string | null;
  pausedAt: string | null;
  restoreDeadline: string | null;
  restoreDeadlineSource?: 'estimate' | 'api-ok' | 'api-blocked';
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

/**
 * Fusionne méta utilisateur + observations + échéance de restauration.
 * `apiDeadline` : si GET /restore a confirmé ou bloqué la fenêtre, on l'utilise
 * à la place de (ou en complément de) l'estimation locale.
 */
export function buildProjectMeta(
  userMeta: UserProjectMeta,
  observation: Pick<ProjectObservation, 'lastSeenActiveAt' | 'pausedAt'>,
  restoreWindowDays: number,
  apiDeadline?: {
    deadline: string | null;
    source: 'api-ok' | 'api-blocked';
  } | null
): ProjectMetaFields {
  const estimate = estimateRestoreDeadline(
    observation.pausedAt,
    restoreWindowDays
  );
  if (apiDeadline?.source === 'api-blocked') {
    return {
      ...userMeta,
      lastSeenActiveAt: observation.lastSeenActiveAt,
      pausedAt: observation.pausedAt,
      // Échéance déjà passée → l'UI / les alertes J-7·J-1 voient la fenêtre close.
      restoreDeadline: apiDeadline.deadline ?? new Date(0).toISOString(),
      restoreDeadlineSource: 'api-blocked',
    };
  }
  if (apiDeadline?.source === 'api-ok') {
    return {
      ...userMeta,
      lastSeenActiveAt: observation.lastSeenActiveAt,
      pausedAt: observation.pausedAt,
      restoreDeadline: apiDeadline.deadline ?? estimate,
      restoreDeadlineSource: 'api-ok',
    };
  }
  return {
    ...userMeta,
    lastSeenActiveAt: observation.lastSeenActiveAt,
    pausedAt: observation.pausedAt,
    restoreDeadline: estimate,
    restoreDeadlineSource: estimate ? 'estimate' : undefined,
  };
}
