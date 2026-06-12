/**
 * Provider réel — Supabase Management API v1 (https://api.supabase.com).
 *
 * ENDPOINTS DOCUMENTÉS UNIQUEMENT (spec OpenAPI vérifiée le 2026-06-10) :
 *   GET  /v1/organizations
 *   GET  /v1/projects
 *   POST /v1/projects/{ref}/pause
 *   POST /v1/projects/{ref}/restore
 *   POST /v1/projects/{ref}/database/query/read-only   [Beta]
 *
 * Egress : AUCUN endpoint public documenté n'expose la consommation egress
 * du Free Plan (le dashboard utilise une API plateforme privée).
 * TODO(provider) : brancher ici une source légitime le jour où Supabase
 * documente un endpoint d'usage — en attendant, egressBytes = null et l'UI
 * affiche « non disponible » (jamais de valeur inventée).
 */
import {
  SQL_DB_SIZE,
  SQL_MAU_ESTIMATE,
  SQL_STORAGE_SIZE,
  extractScalar,
  parseOrganizations,
  parseProjects,
} from '../../../shared/supabaseApi.ts';
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

  async listOrganizations(
    accountKey: string,
    pat: string
  ): Promise<RawOrganization[]> {
    const data = await this.http.request<unknown>(
      accountKey,
      `${BASE_URL}/v1/organizations`,
      { method: 'GET', headers: this.headers(pat) },
      true
    );
    return parseOrganizations(data);
  }

  async listProjects(accountKey: string, pat: string): Promise<RawProject[]> {
    const data = await this.http.request<unknown>(
      accountKey,
      `${BASE_URL}/v1/projects`,
      { method: 'GET', headers: this.headers(pat) },
      true
    );
    return parseProjects(data);
  }

  async pauseProject(
    accountKey: string,
    pat: string,
    ref: string
  ): Promise<void> {
    await this.http.request<unknown>(
      accountKey,
      `${BASE_URL}/v1/projects/${encodeURIComponent(ref)}/pause`,
      { method: 'POST', headers: this.headers(pat) },
      false
    );
  }

  async restoreProject(
    accountKey: string,
    pat: string,
    ref: string
  ): Promise<void> {
    await this.http.request<unknown>(
      accountKey,
      `${BASE_URL}/v1/projects/${encodeURIComponent(ref)}/restore`,
      { method: 'POST', headers: this.headers(pat) },
      false
    );
  }

  async collectMetrics(
    accountKey: string,
    pat: string,
    ref: string
  ): Promise<ProviderMetrics> {
    const [dbSizeBytes, storageBytes, mau] = await Promise.all([
      this.runScalar(accountKey, pat, ref, SQL_DB_SIZE),
      this.runScalar(accountKey, pat, ref, SQL_STORAGE_SIZE),
      this.runScalar(accountKey, pat, ref, SQL_MAU_ESTIMATE),
    ]);
    return {
      dbSizeBytes,
      storageBytes,
      mau,
      egressBytes: null, // TODO(provider) : pas d'endpoint documenté (cf. en-tête)
      measuredAt: new Date().toISOString(),
    };
  }

  /**
   * Exécute une requête SQL read-only et extrait le scalaire `v` de la
   * première ligne. Le format de réponse de l'endpoint Beta n'étant pas
   * contractuel, le parsing est défensif : toute forme inattendue → null.
   */
  private async runScalar(
    accountKey: string,
    pat: string,
    ref: string,
    query: string
  ): Promise<number | null> {
    try {
      const data = await this.http.request<unknown>(
        accountKey,
        `${BASE_URL}/v1/projects/${encodeURIComponent(ref)}/database/query/read-only`,
        {
          method: 'POST',
          headers: this.headers(pat),
          body: JSON.stringify({ query }),
        },
        false
      );
      return extractScalar(data);
    } catch {
      return null; // métrique indisponible — l'appelant marque « unavailable »
    }
  }
}
