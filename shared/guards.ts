/**
 * Garde-fous métier : limite de 2 projets actifs par compte Free,
 * suggestions de mise en pause, fenêtre de restaurabilité estimée.
 */
import {
  countsTowardActiveLimit,
  isRestorable,
  type SupabaseProjectStatus,
} from './status.ts';

/** Limite opérationnelle du plan Free : 2 projets actifs par compte. */
export const ACTIVE_PROJECT_LIMIT = 2;

/**
 * Fenêtre de restauration ESTIMÉE : au-delà de ~90 jours de pause, un projet
 * Free ne peut plus être restauré en place (politique Supabase, susceptible
 * d'évoluer — valeur surchargeable dans les Réglages).
 */
export const RESTORE_WINDOW_DAYS = 90;

/** Le strict nécessaire pour raisonner sur un projet, côté front comme serveur. */
export interface ProjectLite {
  ref: string;
  name: string;
  status: SupabaseProjectStatus;
  favorite: boolean;
  demoFrequent: boolean;
  tags: string[];
  /** ISO — dernière fois où Miss Supaboss a observé le projet actif. */
  lastSeenActiveAt: string | null;
}

/** Tag réservé : un projet « critique démo » n'est jamais suggéré en pause. */
export const DEMO_CRITICAL_TAG = 'critique-demo';

/** Ne requiert que `status` : accepte ProjectLite comme ProjectDto. */
export function activeProjects<P extends { status: SupabaseProjectStatus }>(
  projects: readonly P[]
): P[] {
  return projects.filter(p => countsTowardActiveLimit(p.status));
}

export interface RestoreAssessment<P extends ProjectLite = ProjectLite> {
  allowed: boolean;
  reason:
    | 'ok'
    | 'not-restorable'
    | 'limit-reached'
    | 'unknown-project'
    | 'already-active';
  activeCount: number;
  limit: number;
  /** Projets à mettre en pause pour libérer un slot (les moins « coûteux » d'abord). */
  suggestions: P[];
}

/**
 * Évalue la restauration de `targetRef` sur un compte donné.
 * `limit-reached` n'est PAS bloquant côté produit : l'UI exige une
 * confirmation forte et propose les pauses suggérées (spec garde-fous).
 */
export function evaluateRestore<P extends ProjectLite>(
  projects: readonly P[],
  targetRef: string,
  limit: number = ACTIVE_PROJECT_LIMIT
): RestoreAssessment<P> {
  const actives = activeProjects(projects);
  const base = { activeCount: actives.length, limit };
  const target = projects.find(p => p.ref === targetRef);

  if (!target) {
    return {
      ...base,
      allowed: false,
      reason: 'unknown-project',
      suggestions: [],
    };
  }
  if (countsTowardActiveLimit(target.status)) {
    return {
      ...base,
      allowed: false,
      reason: 'already-active',
      suggestions: [],
    };
  }
  if (!isRestorable(target.status)) {
    return {
      ...base,
      allowed: false,
      reason: 'not-restorable',
      suggestions: [],
    };
  }
  if (actives.length >= limit) {
    const needed = actives.length - limit + 1;
    return {
      ...base,
      allowed: false,
      reason: 'limit-reached',
      suggestions: suggestPauses(actives, needed),
    };
  }
  return { ...base, allowed: true, reason: 'ok', suggestions: [] };
}

/**
 * Classe les projets actifs du moins au plus « coûteux » à mettre en pause :
 * d'abord ni favori, ni démo fréquente, ni critique démo, puis par dernière
 * activité observée la plus ancienne. Retourne les `needed` premiers.
 */
export function suggestPauses<P extends ProjectLite>(
  actives: readonly P[],
  needed: number
): P[] {
  const cost = (p: P): number =>
    (p.favorite ? 2 : 0) +
    (p.demoFrequent ? 2 : 0) +
    (p.tags.includes(DEMO_CRITICAL_TAG) ? 8 : 0);

  return [...actives]
    .sort((a, b) => {
      const diff = cost(a) - cost(b);
      if (diff !== 0) return diff;
      const aSeen = a.lastSeenActiveAt ?? '';
      const bSeen = b.lastSeenActiveAt ?? '';
      return aSeen.localeCompare(bSeen); // plus ancien d'abord
    })
    .slice(0, Math.max(0, needed));
}

/** Échéance estimée de restaurabilité (pausedAt + fenêtre), null si inconnue. */
export function estimateRestoreDeadline(
  pausedAt: string | null,
  windowDays: number = RESTORE_WINDOW_DAYS
): string | null {
  if (!pausedAt) return null;
  const t = Date.parse(pausedAt);
  if (Number.isNaN(t)) return null;
  return new Date(t + windowDays * 24 * 60 * 60 * 1000).toISOString();
}

export function isRestoreWindowExpired(
  deadline: string | null,
  now: Date = new Date()
): boolean {
  if (!deadline) return false;
  const t = Date.parse(deadline);
  return !Number.isNaN(t) && now.getTime() > t;
}
