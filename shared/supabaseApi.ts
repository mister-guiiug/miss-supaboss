/**
 * Contrat de la Supabase Management API v1 (champs consommés) — PARTAGÉ entre
 * le provider serveur (`server/src/supabase/management.ts`) et le client
 * navigateur local-first (`src/api/management/browserClient.ts`), pour qu'une
 * seule définition de schéma/mapping fasse foi.
 *
 * Spec OpenAPI : https://api.supabase.com/api/v1-json (vérifiée le 2026-06-12).
 *   - GET /v1/organizations → [{ id (déprécié), slug, name }]
 *   - GET /v1/projects      → [{ ref, organization_slug, status, … }]
 *   `id`/`organization_id` sont marqués DÉPRÉCIÉS au profit de `slug`/
 *   `organization_slug` : on ne lit donc que les `slug` (clés de jointure).
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

/** Projet tel que consommé (GET /v1/projects). */
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

export const projectsSchema = z.array(
  z.object({
    ref: z.string(),
    name: z.string(),
    region: z.string(),
    organization_slug: z.string(),
    status: z.string(),
    created_at: z.string(),
  })
);

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
  return projectsSchema.parse(data).map(p => ({
    ref: p.ref,
    name: p.name,
    region: p.region,
    organizationSlug: p.organization_slug,
    status: toStatus(p.status),
    createdAt: p.created_at,
  }));
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
