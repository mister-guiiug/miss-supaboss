/**
 * Contrat de la Supabase Management API v1 (champs consommés) — PARTAGÉ entre
 * le provider serveur (`server/src/supabase/management.ts`) et le client
 * navigateur local-first (`src/api/management/browserClient.ts`), pour qu'une
 * seule définition de schéma/mapping fasse foi.
 *
 * Spec OpenAPI : https://api.supabase.com/api/v1-json (revérifiée le 2026-11-01).
 *   - GET /v1/organizations → [{ id (déprécié), slug, name }]
 *   - GET /v1/projects      → [{ ref, organization_slug, status, … }]
 *     (inventaire global ; insuffisant pour les PAT fine-grained scoped
 *     à une org, et susceptible de renvoyer une vue incomplète)
 *   - GET /v1/organizations/{slug}/projects → { projects, pagination }
 *     (inventaire PAGINÉ par organisation — chemin que le Studio a adopté ;
 *     c'est celui qui garantit que chaque org a bien ses projets)
 *   `id`/`organization_id` sont marqués DÉPRÉCIÉS au profit de `slug`/
 *   `organization_slug` : on joint sur les `slug`, avec repli sur `organization_id`.
 */
import { z } from 'zod';
import {
  SUPABASE_PROJECT_STATUSES,
  type SupabaseProjectStatus,
} from './status.ts';

/** Organisation telle que consommée (GET /v1/organizations). */
export interface RawOrganization {
  slug: string;
  name: string;
}

/** Projet tel que consommé (GET /v1/projects ou /v1/organizations/{slug}/projects). */
export interface RawProject {
  ref: string;
  name: string;
  region: string;
  organizationSlug: string;
  status: SupabaseProjectStatus;
  createdAt: string;
}

export const organizationsSchema = z.array(
  z.object({ slug: z.string(), name: z.string() })
);

/** Une ligne de GET /v1/projects — `organization_slug` préféré, `organization_id` en repli. */
const globalProjectSchema = z.object({
  ref: z.string(),
  name: z.string(),
  region: z.string().nullish(),
  organization_slug: z.string().nullish(),
  organization_id: z.string().nullish(),
  status: z.string(),
  created_at: z.string().nullish(),
});

export const projectsSchema = z.array(globalProjectSchema);

/**
 * Page de GET /v1/organizations/{slug}/projects. Pas d'`organization_slug` dans
 * la réponse : le slug d'URL est la clé de rattachement. `inserted_at` tient
 * lieu de `created_at`.
 */
const orgProjectRowSchema = z.object({
  ref: z.string(),
  name: z.string(),
  region: z.string().nullish(),
  status: z.string(),
  inserted_at: z.string().nullish(),
});

export const organizationProjectsPageSchema = z.object({
  projects: z.array(orgProjectRowSchema),
  pagination: z
    .object({
      count: z.number(),
      limit: z.number(),
      offset: z.number(),
    })
    .partial()
    .optional(),
});

/** Statut brut → statut typé (toute valeur hors enum spec → 'UNKNOWN'). */
export function toStatus(raw: string): SupabaseProjectStatus {
  return (SUPABASE_PROJECT_STATUSES as readonly string[]).includes(raw)
    ? (raw as SupabaseProjectStatus)
    : 'UNKNOWN';
}

/** Parse + normalise la réponse de GET /v1/organizations. */
export function parseOrganizations(data: unknown): RawOrganization[] {
  return organizationsSchema.parse(data);
}

/** Parse + normalise la réponse de GET /v1/projects (snake_case → camelCase). */
export function parseProjects(data: unknown): RawProject[] {
  return projectsSchema.parse(data).flatMap(p => {
    const organizationSlug = p.organization_slug ?? p.organization_id;
    if (!organizationSlug) return [];
    return [
      {
        ref: p.ref,
        name: p.name,
        region: p.region ?? '',
        organizationSlug,
        status: toStatus(p.status),
        createdAt: p.created_at ?? '',
      },
    ];
  });
}

/**
 * Parse une page de GET /v1/organizations/{slug}/projects et rattache le slug
 * d'organisation (absent du corps de réponse).
 */
export function parseOrganizationProjectsPage(
  data: unknown,
  organizationSlug: string
): { projects: RawProject[]; total: number | null; pageSize: number } {
  const page = organizationProjectsPageSchema.parse(data);
  const projects = page.projects.map(p => ({
    ref: p.ref,
    name: p.name,
    region: p.region ?? '',
    organizationSlug,
    status: toStatus(p.status),
    createdAt: p.inserted_at ?? '',
  }));
  const total = page.pagination?.count ?? null;
  const pageSize = page.pagination?.limit ?? projects.length;
  return { projects, total, pageSize };
}

/* ── Métriques de quota via SQL read-only (endpoint Beta documenté) ───────
   POST /v1/projects/{ref}/database/query/read-only — exécuté en lecture seule
   (`supabase_read_only_user`), références qualifiées par schéma (exigence de
   l'endpoint). Le projet doit être ACTIF (les requêtes échouent sinon → null
   = « non disponible », jamais de valeur inventée). Egress : aucun endpoint
   public → toujours indisponible. */
export const SQL_DB_SIZE = 'select pg_database_size(current_database()) as v;';
export const SQL_STORAGE_SIZE =
  "select coalesce(sum((o.metadata->>'size')::bigint), 0) as v from storage.objects o;";
export const SQL_MAU_ESTIMATE =
  "select count(*) as v from auth.users u where u.last_sign_in_at >= date_trunc('month', now());";

function numberish(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Version disponible pour restore (GET /v1/projects/{ref}/restore). */
export interface RestoreVersion {
  version: string;
  releaseChannel: string | null;
  postgresEngine: string | null;
}

const restoreVersionsSchema = z.object({
  available_versions: z
    .array(
      z.object({
        version: z.string(),
        release_channel: z.string().nullish(),
        postgres_engine: z.string().nullish(),
      })
    )
    .default([]),
});

/**
 * Parse GET /v1/projects/{ref}/restore. L'API expose les versions Postgres
 * restaurables — pas une date d'échéance Free Plan. Une réponse 200 avec au
 * moins une version = restauration encore possible côté plateforme.
 */
export function parseRestoreVersions(data: unknown): RestoreVersion[] {
  const parsed = restoreVersionsSchema.safeParse(data);
  if (!parsed.success) return [];
  return parsed.data.available_versions.map(v => ({
    version: v.version,
    releaseChannel: v.release_channel ?? null,
    postgresEngine: v.postgres_engine ?? null,
  }));
}

/** Santé d'un service (GET /v1/projects/{ref}/health). */
export interface ServiceHealth {
  name: string;
  healthy: boolean;
  status: string | null;
  error: string | null;
}

const serviceHealthSchema = z.array(
  z.object({
    name: z.string(),
    healthy: z.boolean(),
    status: z.string().nullish(),
    error: z.string().nullish(),
  })
);

export function parseServiceHealth(data: unknown): ServiceHealth[] {
  const parsed = serviceHealthSchema.safeParse(data);
  if (!parsed.success) return [];
  return parsed.data.map(s => ({
    name: s.name,
    healthy: s.healthy,
    status: s.status ?? null,
    error: s.error ?? null,
  }));
}

/** Accepte [{v}], {result:[{v}]}, [[v]]… et retourne le premier nombre trouvé.
 *  Le format de l'endpoint Beta n'étant pas contractuel, le parsing est
 *  défensif : toute forme inattendue → null. */
export function extractScalar(data: unknown): number | null {
  const rows = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && 'result' in data
      ? (data as { result: unknown }).result
      : null;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first: unknown = rows[0];
  if (typeof first === 'number') return first;
  if (Array.isArray(first)) return numberish(first[0]);
  if (typeof first === 'object' && first !== null) {
    for (const value of Object.values(first)) {
      const n = numberish(value);
      if (n !== null) return n;
    }
  }
  return null;
}
