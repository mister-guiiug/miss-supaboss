/**
 * Opérations Management API v1 partagées navigateur / serveur.
 * Le transport (proxy CORS ou ResilientClient) est injecté : ce module
 * ne connaît que des chemins `/v1/…` et les parseurs `shared/supabaseApi`.
 */
import {
  SQL_DB_SIZE,
  SQL_MAU_ESTIMATE,
  SQL_STORAGE_SIZE,
  extractScalar,
  parseOrganizationProjectsPage,
  parseOrganizations,
  parseProjects,
  parseRestoreVersions,
  parseServiceHealth,
  type RawOrganization,
  type RawProject,
  type RestoreVersion,
  type ServiceHealth,
} from '../supabaseApi.ts';

/** Taille de page max documentée pour GET /v1/organizations/{slug}/projects. */
export const ORG_PROJECTS_PAGE_SIZE = 100;

export type ManagementRequest = (
  path: string,
  init?: { method?: string; body?: string }
) => Promise<unknown>;

export interface ManagementOps {
  listOrganizations(): Promise<RawOrganization[]>;
  listProjects(organizations?: RawOrganization[]): Promise<RawProject[]>;
  pause(ref: string): Promise<void>;
  restore(ref: string): Promise<void>;
  listRestoreVersions(
    ref: string
  ): Promise<{ ok: boolean; versions: RestoreVersion[] }>;
  getProjectHealth(ref: string, services?: string[]): Promise<ServiceHealth[]>;
  collectMetrics(ref: string): Promise<{
    dbSizeBytes: number | null;
    storageBytes: number | null;
    mau: number | null;
    failed: boolean;
  }>;
}

export interface ManagementOpsOptions {
  /**
   * Erreur « dure » pour la collecte de métriques (réseau / auth).
   * Par défaut : toute Error est dure.
   */
  isHardMetricsError?: (error: unknown) => boolean;
  /**
   * Codes HTTP qui signifient « fenêtre de restore close » (défaut 400/404/410).
   * Si le transport lève autrement, renvoyer `{ ok:false }` via ce prédicat.
   */
  isRestoreBlockedError?: (error: unknown) => boolean;
}

/**
 * Fabrique les opérations Management sur un `request(path, init)` déjà
 * authentifié (PAT dans les en-têtes côté transport).
 */
export function createManagementOps(
  request: ManagementRequest,
  options: ManagementOpsOptions = {}
): ManagementOps {
  const isHard =
    options.isHardMetricsError ?? ((e: unknown) => e instanceof Error);
  const isBlocked =
    options.isRestoreBlockedError ??
    ((e: unknown) => {
      const status =
        e && typeof e === 'object' && 'status' in e
          ? Number((e as { status: unknown }).status)
          : NaN;
      return status === 400 || status === 404 || status === 410;
    });

  async function listAllProjectsForOrganization(
    slug: string
  ): Promise<RawProject[]> {
    const out: RawProject[] = [];
    let offset = 0;
    for (;;) {
      const path =
        `/v1/organizations/${encodeURIComponent(slug)}/projects` +
        `?limit=${ORG_PROJECTS_PAGE_SIZE}&offset=${offset}`;
      const page = parseOrganizationProjectsPage(await request(path), slug);
      out.push(...page.projects);
      offset += page.projects.length;
      if (
        page.projects.length === 0 ||
        (page.total !== null && offset >= page.total) ||
        page.projects.length < ORG_PROJECTS_PAGE_SIZE
      ) {
        break;
      }
    }
    return out;
  }

  return {
    async listOrganizations() {
      return parseOrganizations(await request('/v1/organizations'));
    },

    async listProjects(organizations) {
      const orgs = organizations ?? (await this.listOrganizations());
      if (orgs.length > 0) {
        const pages = await Promise.allSettled(
          orgs.map(org => listAllProjectsForOrganization(org.slug))
        );
        const fulfilled = pages.filter(
          (r): r is PromiseFulfilledResult<RawProject[]> =>
            r.status === 'fulfilled'
        );
        if (fulfilled.length > 0) return fulfilled.flatMap(r => r.value);
      }
      return parseProjects(await request('/v1/projects'));
    },

    async pause(ref) {
      const id = encodeURIComponent(ref);
      await request(`/v1/projects/${id}/pause`, {
        method: 'POST',
        body: '{}',
      });
    },

    async restore(ref) {
      const id = encodeURIComponent(ref);
      await request(`/v1/projects/${id}/restore`, {
        method: 'POST',
        body: '{}',
      });
    },

    async listRestoreVersions(ref) {
      const id = encodeURIComponent(ref);
      try {
        const versions = parseRestoreVersions(
          await request(`/v1/projects/${id}/restore`)
        );
        return { ok: true, versions };
      } catch (e) {
        if (isBlocked(e)) return { ok: false, versions: [] };
        throw e;
      }
    },

    async getProjectHealth(
      ref,
      services = ['auth', 'db', 'storage', 'realtime', 'rest']
    ) {
      const id = encodeURIComponent(ref);
      const qs = `services=${services.map(encodeURIComponent).join(',')}`;
      return parseServiceHealth(
        await request(`/v1/projects/${id}/health?${qs}`)
      );
    },

    async collectMetrics(ref) {
      const id = encodeURIComponent(ref);
      const run = async (query: string): Promise<number | null> => {
        try {
          const data = await request(
            `/v1/projects/${id}/database/query/read-only`,
            { method: 'POST', body: JSON.stringify({ query }) }
          );
          return extractScalar(data);
        } catch (e) {
          if (isHard(e)) throw e;
          return null;
        }
      };
      try {
        const [dbSizeBytes, storageBytes, mau] = await Promise.all([
          run(SQL_DB_SIZE),
          run(SQL_STORAGE_SIZE),
          run(SQL_MAU_ESTIMATE),
        ]);
        return { dbSizeBytes, storageBytes, mau, failed: false };
      } catch {
        return {
          dbSizeBytes: null,
          storageBytes: null,
          mau: null,
          failed: true,
        };
      }
    },
  };
}
