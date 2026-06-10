/** Contexte injecté dans toutes les routes (pas de singleton global). */
import type { Env } from './env.ts';
import type { Store, UserRow } from './db.ts';
import type { FleetService } from './fleet.ts';

export interface AppContext {
  env: Env;
  store: Store;
  fleet: FleetService;
  masterKey: string;
  version: string;
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
