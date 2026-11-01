/**
 * Client navigateur de la Supabase Management API, via le proxy CORS
 * (cf. proxy/ — Cloudflare Worker). Le PAT reste sur l'appareil ; les
 * opérations métier sont celles de `shared/management/ops`.
 */
import {
  createManagementOps,
  type ManagementOps,
} from '../../../shared/management/ops.ts';
import type {
  RawOrganization,
  RawProject,
  RestoreVersion,
  ServiceHealth,
} from '../../../shared/supabaseApi.ts';
import { authFailures } from '../authFailures.ts';
import { ApiError } from '../types.ts';

function maybeWarnPatRotation(): void {
  if (!authFailures.shouldWarn()) return;
  authFailures.markWarned();
  void import('../../store/useUiStore.ts').then(({ toast }) => {
    void import('../../i18n/index.ts').then(({ translate }) => {
      toast.error(translate('authFailures.toast'));
    });
  });
}

export class BrowserManagementClient {
  private readonly proxyBase: string;
  private readonly opsFor = new Map<string, ManagementOps>();

  constructor(proxyBase: string) {
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
      authFailures.record(res.status);
      if (res.status === 401) maybeWarnPatRotation();
      let code = 'supabase';
      let message = `Erreur Supabase (HTTP ${res.status})`;
      if (res.status === 401) {
        code = 'pat-invalid';
        message = 'PAT invalide ou expiré';
      } else if (res.status === 403) {
        code = 'forbidden';
        message =
          'Accès refusé — élargissez le PAT (orgs + projects read, pause/restore si besoin)';
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
        // corps non-JSON
      }
      throw new ApiError(res.status, code, message);
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  private ops(pat: string): ManagementOps {
    let cached = this.opsFor.get(pat);
    if (!cached) {
      cached = createManagementOps(
        (path, init) =>
          this.call(pat, path, {
            method: init?.method,
            body: init?.body,
          }),
        {
          isHardMetricsError: (e: unknown) =>
            e instanceof ApiError &&
            (e.status === 0 || e.status === 401 || e.status === 403),
          isRestoreBlockedError: (e: unknown) =>
            e instanceof ApiError &&
            (e.status === 404 || e.status === 400 || e.status === 410),
        }
      );
      this.opsFor.set(pat, cached);
    }
    return cached;
  }

  listOrganizations(pat: string): Promise<RawOrganization[]> {
    return this.ops(pat).listOrganizations();
  }

  listProjects(
    pat: string,
    organizations?: RawOrganization[]
  ): Promise<RawProject[]> {
    return this.ops(pat).listProjects(organizations);
  }

  pause(pat: string, ref: string): Promise<void> {
    return this.ops(pat).pause(ref);
  }

  restore(pat: string, ref: string): Promise<void> {
    return this.ops(pat).restore(ref);
  }

  listRestoreVersions(
    pat: string,
    ref: string
  ): Promise<{ ok: boolean; versions: RestoreVersion[] }> {
    return this.ops(pat).listRestoreVersions(ref);
  }

  getProjectHealth(
    pat: string,
    ref: string,
    services?: string[]
  ): Promise<ServiceHealth[]> {
    return this.ops(pat).getProjectHealth(ref, services);
  }

  collectMetrics(
    pat: string,
    ref: string
  ): Promise<{
    dbSizeBytes: number | null;
    storageBytes: number | null;
    mau: number | null;
    failed: boolean;
  }> {
    return this.ops(pat).collectMetrics(ref);
  }
}
