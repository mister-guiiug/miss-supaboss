/** Contexte injecté dans toutes les routes (pas de singleton global). */
import type { Env } from './env.ts';
import type { Store, UserRow } from './db.ts';
import { FleetService } from './fleet.ts';
import { AlertService } from './alerts.ts';
import type { HostResolver } from './notify/destination.ts';
import { NotificationService } from './notify/service.ts';
import { ScheduleService } from './schedules.ts';
import type { SupabaseProvider } from './supabase/provider.ts';

export interface AppContext {
  env: Env;
  store: Store;
  fleet: FleetService;
  masterKey: string;
  version: string;
  /** Canaux de notification (Web Push, webhook) et remise des messages. */
  notifier: NotificationService;
  /** Alertes évaluées à chaque synchro de la flotte. */
  alerts: AlertService;
  /** Plannings de pause / restauration. */
  schedules: ScheduleService;
}

export interface ContextInput {
  env: Env;
  store: Store;
  provider: SupabaseProvider;
  masterKey: string;
  version: string;
  /** Injectable pour les tests : aucune notification ne quitte la machine. */
  fetchImpl?: typeof fetch;
  /** Résolution DNS de la garde anti-SSRF — injectable pour les tests. */
  resolver?: HostResolver;
  onError?: (error: unknown) => void;
}

/**
 * Assemble les services : le même câblage pour le serveur et pour les tests,
 * sans quoi un test pourrait éprouver une app dont les alertes ne sont
 * branchées sur rien.
 */
export function createAppContext(input: ContextInput): AppContext {
  const fleet = new FleetService(input.store, input.provider, input.masterKey);
  const notifier = new NotificationService(input.store, input.masterKey, {
    subject: input.env.vapidSubject,
    allowPrivateWebhooks: input.env.webhookAllowPrivate,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.resolver ? { resolver: input.resolver } : {}),
  });
  const alerts = new AlertService(
    input.store,
    notifier,
    input.onError ? { onError: input.onError } : {}
  );
  alerts.attach(fleet);
  return {
    env: input.env,
    store: input.store,
    fleet,
    masterKey: input.masterKey,
    version: input.version,
    notifier,
    alerts,
    schedules: new ScheduleService(input.store, fleet),
  };
}

/** Hiérarchie RBAC : viewer ⊂ operator ⊂ admin. */
const ROLE_RANK = { viewer: 0, operator: 1, admin: 2 } as const;
export type MinRole = keyof typeof ROLE_RANK;

export function hasRole(user: UserRow, min: MinRole): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[min];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
  }
}
