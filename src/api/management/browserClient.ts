/**
 * Client navigateur de la Supabase Management API, via le proxy CORS
 * (cf. supabase/functions/supabase-management). Le PAT de l'utilisateur reste
 * sur l'appareil (local-first) et n'est transmis qu'au proxy configuré, en
 * HTTPS, dans l'en-tête Authorization. Réponses validées par les schémas
 * partagés (`shared/supabaseApi`).
 */
import {
  parseOrganizations,
  parseProjects,
  type RawOrganization,
  type RawProject,
} from '../../../shared/supabaseApi.ts';
import { ApiError } from '../types.ts';

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

  async listProjects(pat: string): Promise<RawProject[]> {
    return parseProjects(await this.call(pat, '/v1/projects'));
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
}
