/** Clés de cache TanStack Query — source unique pour invalidation. */
export const queryKeys = {
  fleet: (refresh = false) => ['fleet', { refresh }] as const,
  fleetMetrics: (refresh = false) => ['fleet', 'metrics', { refresh }] as const,
  settings: () => ['settings'] as const,
  operations: (limit = 100) => ['operations', { limit }] as const,
  accounts: () => ['accounts'] as const,
  assessRestore: (accountId: string, ref: string) =>
    ['assessRestore', accountId, ref] as const,
} as const;
