/**
 * Provider réel — Supabase Management API v1 (https://api.supabase.com).
 * Les chemins et le parsing sont ceux de `shared/management/ops` ; ce fichier
 * branche le ResilientClient (budget, retry, circuit breaker) et l'identité
 * de compte (`accountKey`).
 *
 * Egress : AUCUN endpoint public documenté — egressBytes = null.
 */
import { createManagementOps } from '../../../shared/management/ops.ts';
import type {
  ProviderMetrics,
  RawOrganization,
  RawProject,
  SupabaseProvider,
} from './provider.ts';
import type { ResilientClient } from './http.ts';

const BASE_URL = 'https://api.supabase.com';

export class ManagementApiProvider implements SupabaseProvider {
  private readonly http: ResilientClient;

  constructor(http: ResilientClient) {
    this.http = http;
  }

  private headers(pat: string): Record<string, string> {
    return {
      authorization: `Bearer ${pat}`,
      'content-type': 'application/json',
    };
  }

  private ops(accountKey: string, pat: string) {
    return createManagementOps(
      async (path, init) => {
        const method = init?.method ?? 'GET';
        const idempotent = method === 'GET';
        return this.http.request<unknown>(
          accountKey,
          `${BASE_URL}${path}`,
          {
            method,
            headers: this.headers(pat),
            ...(init?.body !== undefined ? { body: init.body } : {}),
          },
          idempotent
        );
      },
      {
        // Côté serveur : une métrique en échec → null, jamais « failed ».
        isHardMetricsError: () => false,
      }
    );
  }

  listOrganizations(
    accountKey: string,
    pat: string
  ): Promise<RawOrganization[]> {
    return this.ops(accountKey, pat).listOrganizations();
  }

  listProjects(
    accountKey: string,
    pat: string,
    organizations?: RawOrganization[]
  ): Promise<RawProject[]> {
    return this.ops(accountKey, pat).listProjects(organizations);
  }

  pauseProject(accountKey: string, pat: string, ref: string): Promise<void> {
    return this.ops(accountKey, pat).pause(ref);
  }

  restoreProject(accountKey: string, pat: string, ref: string): Promise<void> {
    return this.ops(accountKey, pat).restore(ref);
  }

  async collectMetrics(
    accountKey: string,
    pat: string,
    ref: string
  ): Promise<ProviderMetrics> {
    const m = await this.ops(accountKey, pat).collectMetrics(ref);
    return {
      dbSizeBytes: m.dbSizeBytes,
      storageBytes: m.storageBytes,
      mau: m.mau,
      egressBytes: null,
      measuredAt: new Date().toISOString(),
    };
  }
}
