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
import { z } from 'zod';
import {
  SUPABASE_PROJECT_STATUSES,
  type SupabaseProjectStatus,
} from '../../../shared/status.ts';
import type {
  ProviderMetrics,
  RawOrganization,
  RawProject,
  SupabaseProvider,
} from './provider.ts';
import type { ResilientClient } from './http.ts';

const BASE_URL = 'https://api.supabase.com';

const organizationsSchema = z.array(
  z.object({ slug: z.string(), name: z.string() })
);

const projectsSchema = z.array(
  z.object({
    ref: z.string(),
    name: z.string(),
    region: z.string(),
    organization_slug: z.string(),
    status: z.string(),
    created_at: z.string(),
  })
);

function toStatus(raw: string): SupabaseProjectStatus {
  return (SUPABASE_PROJECT_STATUSES as readonly string[]).includes(raw)
    ? (raw as SupabaseProjectStatus)
    : 'UNKNOWN';
}

/* Requêtes lancées en lecture seule (utilisateur supabase_read_only_user).
   Références qualifiées par schéma — exigence documentée de l'endpoint. */
const SQL_DB_SIZE = 'select pg_database_size(current_database()) as v;';
const SQL_STORAGE_SIZE =
  "select coalesce(sum((o.metadata->>'size')::bigint), 0) as v from storage.objects o;";
const SQL_MAU_ESTIMATE =
  "select count(*) as v from auth.users u where u.last_sign_in_at >= date_trunc('month', now());";

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
    return organizationsSchema.parse(data);
  }

  async listProjects(accountKey: string, pat: string): Promise<RawProject[]> {
    const data = await this.http.request<unknown>(
      accountKey,
      `${BASE_URL}/v1/projects`,
      { method: 'GET', headers: this.headers(pat) },
      true
    );
    return projectsSchema.parse(data).map(p => ({
      ref: p.ref,
      name: p.name,
      region: p.region,
      organizationSlug: p.organization_slug,
      status: toStatus(p.status),
      createdAt: p.created_at,
    }));
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

/** Accepte [{v}], {result:[{v}]}, [[v]]… et retourne le premier nombre trouvé. */
export function extractScalar(data: unknown): number | null {
  const rows = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && 'result' in data
      ? (data as { result: unknown }).result
      : null;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first: unknown = rows[0];
  if (typeof first === 'number') return first;
  if (Array.isArray(first)) {
    const cell: unknown = first[0];
    return numberish(cell);
  }
  if (typeof first === 'object' && first !== null) {
    for (const value of Object.values(first)) {
      const n = numberish(value);
      if (n !== null) return n;
    }
  }
  return null;
}

function numberish(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
