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
