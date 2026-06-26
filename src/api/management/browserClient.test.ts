/**
 * BrowserManagementClient — isolation par PAT au niveau HTTP. Toutes les routes
 * Management partagent la MÊME URL de proxy (?path=/v1/...) ; seul l'en-tête
 * Authorization distingue les comptes. On vérifie donc que chaque appel passe
 * `cache: 'no-store'` : sans ça, le cache HTTP du navigateur (keyé par URL, qui
 * ignore Authorization) resservirait la réponse d'un compte à un autre — la
 * fuite inter-comptes du nom d'organisation / des projets.
 */
import { describe, expect, it, vi } from 'vitest';
import { BrowserManagementClient } from './browserClient.ts';

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Mock typé à la signature de `fetch` → `mock.calls[i][1]` est un RequestInit. */
function stubFetch(res: Response) {
  const fetchImpl = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => res
  );
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
}

describe('BrowserManagementClient — anti-cache HTTP (isolation par PAT)', () => {
  it('listOrganizations interroge le proxy avec cache:"no-store"', async () => {
    const fetchImpl = stubFetch(okJson([{ slug: 'beta', name: 'Beta' }]));
    const orgs = await new BrowserManagementClient(
      'https://proxy.test'
    ).listOrganizations('sbp_B');
    expect(orgs).toEqual([{ slug: 'beta', name: 'Beta' }]);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.cache).toBe('no-store');
    vi.unstubAllGlobals();
  });

  it('listProjects interroge le proxy avec cache:"no-store"', async () => {
    const fetchImpl = stubFetch(
      okJson([
        {
          ref: 'abcdefghijklmnopqrst',
          name: 'P',
          region: 'eu-west-3',
          organization_slug: 'beta',
          status: 'ACTIVE_HEALTHY',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ])
    );
    await new BrowserManagementClient('https://proxy.test').listProjects(
      'sbp_B'
    );
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.cache).toBe('no-store');
    vi.unstubAllGlobals();
  });
});
