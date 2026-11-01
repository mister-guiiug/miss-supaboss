/**
 * Client navigateur de la Supabase Management API, via le proxy CORS
 * (cf. proxy/ — Cloudflare Worker). Le PAT de l'utilisateur reste
 * sur l'appareil (local-first) et n'est transmis qu'au proxy configuré, en
 * HTTPS, dans l'en-tête Authorization. Réponses validées par les schémas
 * partagés (`shared/supabaseApi`).
 */
import {
  SQL_DB_SIZE,
  SQL_MAU_ESTIMATE,
  SQL_STORAGE_SIZE,
  extractScalar,
  parseOrganizationProjectsPage,
  parseOrganizations,
  parseProjects,
  type RawOrganization,
  type RawProject,
} from '../../../shared/supabaseApi.ts';
import { ApiError } from '../types.ts';

/** Taille de page max documentée pour GET /v1/organizations/{slug}/projects. */
const ORG_PROJECTS_PAGE_SIZE = 100;

export class BrowserManagementClient {
  private readonly proxyBase: string;

  constructor(proxyBase: string) {
    // Tolère une barre oblique finale.
    this.proxyBase = proxyBase.replace(/\/+$/, '');
  }

  private url(path: string): string {
    return `${this.proxyBase}?path=${encodeURIComponent(path)}`;
  }

  private async call(
    pat: string,
    path: string,
    init: RequestInit = {}
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        ...init,
        // Jamais le cache HTTP du navigateur : l'URL (?path=/v1/...) est
        // identique pour tous les comptes et le PAT ne vit que dans l'en-tête
        // Authorization. Sans 'no-store', un compte pourrait lire la réponse
        // mise en cache d'un autre (fuite inter-comptes du nom d'org / projets).
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${pat}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new ApiError(
        0,
        'network',
        'Proxy Supabase injoignable (vérifiez VITE_SUPABASE_PROXY)'
      );
    }
    if (!res.ok) {
      let code = 'supabase';
      let message = `Erreur Supabase (HTTP ${res.status})`;
      if (res.status === 401) {
        code = 'pat-invalid';
        message = 'PAT invalide ou expiré';
      } else if (res.status === 403) {
        code = 'forbidden';
        message = 'Accès refusé — le PAT a-t-il la portée requise ?';
      }
      try {
        const body: unknown = await res.json();
        if (
          body !== null &&
          typeof body === 'object' &&
          'message' in body &&
          typeof body.message === 'string'
        ) {
          message = body.message;
        }
      } catch {
        // corps non-JSON : on garde le message générique
      }
      throw new ApiError(res.status, code, message);
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  async listOrganizations(pat: string): Promise<RawOrganization[]> {
    return parseOrganizations(await this.call(pat, '/v1/organizations'));
  }

  /**
   * Inventaire des projets : d'abord par organisation (paginé — le chemin
   * fiable pour les PAT fine-grained et pour ne pas « perdre » une org),
   * avec repli sur GET /v1/projects si l'endpoint org est indisponible.
   *
   * `organizations` déjà chargées évite un second GET /v1/organizations.
   */
  async listProjects(
    pat: string,
    organizations?: RawOrganization[]
  ): Promise<RawProject[]> {
    const orgs = organizations ?? (await this.listOrganizations(pat));
    if (orgs.length > 0) {
      const pages = await Promise.allSettled(
        orgs.map(org => this.listAllProjectsForOrganization(pat, org.slug))
      );
      const fulfilled = pages.filter(
        (r): r is PromiseFulfilledResult<RawProject[]> =>
          r.status === 'fulfilled'
      );
      if (fulfilled.length > 0) return fulfilled.flatMap(r => r.value);
    }
    return parseProjects(await this.call(pat, '/v1/projects'));
  }

  /** Toutes les pages de GET /v1/organizations/{slug}/projects. */
  private async listAllProjectsForOrganization(
    pat: string,
    slug: string
  ): Promise<RawProject[]> {
    const out: RawProject[] = [];
    let offset = 0;
    for (;;) {
      const path =
        `/v1/organizations/${encodeURIComponent(slug)}/projects` +
        `?limit=${ORG_PROJECTS_PAGE_SIZE}&offset=${offset}`;
      const page = parseOrganizationProjectsPage(
        await this.call(pat, path),
        slug
      );
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

  async pause(pat: string, ref: string): Promise<void> {
    await this.call(pat, `/v1/projects/${ref}/pause`, {
      method: 'POST',
      body: '{}',
    });
  }

  async restore(pat: string, ref: string): Promise<void> {
    await this.call(pat, `/v1/projects/${ref}/restore`, {
      method: 'POST',
      body: '{}',
    });
  }

  /**
   * Métriques de quota d'un projet ACTIF via SQL read-only : db size, storage
   * (octets) et MAU estimé. Egress non disponible (aucun endpoint).
   *
   * On sépare deux natures d'échec :
   *   - DUR (réseau / 401 / 403) : le proxy ou le PAT est en cause → la collecte
   *     du projet a échoué (`failed: true`), à remonter à l'utilisateur ;
   *   - DOUX (200 sans donnée exploitable, SQL non applicable…) : la valeur est
   *     simplement `null` (non disponible), sans crier à l'erreur.
   */
  async collectMetrics(
    pat: string,
    ref: string
  ): Promise<{
    dbSizeBytes: number | null;
    storageBytes: number | null;
    mau: number | null;
    failed: boolean;
  }> {
    const isHard = (e: unknown): boolean =>
      e instanceof ApiError &&
      (e.status === 0 || e.status === 401 || e.status === 403);
    const run = async (query: string): Promise<number | null> => {
      try {
        const data = await this.call(
          pat,
          `/v1/projects/${ref}/database/query/read-only`,
          { method: 'POST', body: JSON.stringify({ query }) }
        );
        return extractScalar(data);
      } catch (e) {
        if (isHard(e)) throw e; // remonte : collecte du projet en échec
        return null; // doux : pas de donnée pour cette requête
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
  }
}
