/**
 * Statuts projet de la Supabase Management API v1 (enum `status` du schéma
 * `V1ProjectResponse`, spec OpenAPI https://api.supabase.com/api/v1-json).
 * Source vérifiée le 2026-06-10 — ne pas étendre sans re-vérifier la spec.
 */
export const SUPABASE_PROJECT_STATUSES = [
  'INACTIVE',
  'ACTIVE_HEALTHY',
  'ACTIVE_UNHEALTHY',
  'COMING_UP',
  'UNKNOWN',
  'GOING_DOWN',
  'INIT_FAILED',
  'REMOVED',
  'RESTORING',
  'UPGRADING',
  'PAUSING',
  'RESTORE_FAILED',
  'RESTARTING',
  'PAUSE_FAILED',
  'RESIZING',
] as const;

export type SupabaseProjectStatus = (typeof SUPABASE_PROJECT_STATUSES)[number];

/** Regroupement UI : 5 familles visuelles au lieu de 15 statuts bruts. */
export type StatusGroup =
  | 'active'
  | 'paused'
  | 'transition'
  | 'error'
  | 'unknown';

const GROUPS: Record<SupabaseProjectStatus, StatusGroup> = {
  ACTIVE_HEALTHY: 'active',
  ACTIVE_UNHEALTHY: 'active',
  INACTIVE: 'paused',
  COMING_UP: 'transition',
  RESTORING: 'transition',
  PAUSING: 'transition',
  RESTARTING: 'transition',
  RESIZING: 'transition',
  UPGRADING: 'transition',
  GOING_DOWN: 'transition',
  INIT_FAILED: 'error',
  RESTORE_FAILED: 'error',
  PAUSE_FAILED: 'error',
  REMOVED: 'error',
  UNKNOWN: 'unknown',
};

export function statusGroup(status: SupabaseProjectStatus): StatusGroup {
  return GROUPS[status];
}

/**
 * Le plan Free n'autorise que 2 projets actifs simultanés par compte.
 * Compte « occupant un slot » tout projet qui tourne ou qui démarre :
 * PAUSING reste compté (conservateur — il tourne encore au moment du calcul).
 */
export function countsTowardActiveLimit(
  status: SupabaseProjectStatus
): boolean {
  switch (status) {
    case 'ACTIVE_HEALTHY':
    case 'ACTIVE_UNHEALTHY':
    case 'COMING_UP':
    case 'RESTORING':
    case 'RESTARTING':
    case 'RESIZING':
    case 'UPGRADING':
    case 'PAUSING':
      return true;
    default:
      return false;
  }
}

/** Statuts transitoires à surveiller en polling rapproché. */
export function isTransient(status: SupabaseProjectStatus): boolean {
  return statusGroup(status) === 'transition';
}

/** Un projet ne peut être restauré que depuis l'état en pause. */
export function isRestorable(status: SupabaseProjectStatus): boolean {
  return status === 'INACTIVE' || status === 'RESTORE_FAILED';
}

/** Un projet ne peut être mis en pause que s'il tourne. */
export function isPausable(status: SupabaseProjectStatus): boolean {
  return (
    status === 'ACTIVE_HEALTHY' ||
    status === 'ACTIVE_UNHEALTHY' ||
    status === 'PAUSE_FAILED'
  );
}

/** Libellés FR affichés dans l'UI. */
export const STATUS_LABELS: Record<SupabaseProjectStatus, string> = {
  ACTIVE_HEALTHY: 'Actif',
  ACTIVE_UNHEALTHY: 'Actif (dégradé)',
  INACTIVE: 'En pause',
  COMING_UP: 'Démarrage…',
  RESTORING: 'Restauration…',
  PAUSING: 'Mise en pause…',
  RESTARTING: 'Redémarrage…',
  RESIZING: 'Redimensionnement…',
  UPGRADING: 'Mise à niveau…',
  GOING_DOWN: 'Arrêt…',
  INIT_FAILED: 'Échec de création',
  RESTORE_FAILED: 'Échec de restauration',
  PAUSE_FAILED: 'Échec de pause',
  REMOVED: 'Supprimé',
  UNKNOWN: 'Inconnu',
};
