/**
 * API « réelle local-first » : avec un PAT, on récupère bien les organisations
 * et le STATUT des projets associés (via le proxy, fetch mocké), et le compte
 * est persisté localement (clé dédiée, séparée de la démo).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalRealApi, REAL_STORAGE_KEY } from './localRealApi.ts';
import { patVault } from './crypto/patVault.ts';

const PROXY = 'https://proxy.test/supabase-management';

// Réponses conformes à la spec Management API (champs supplémentaires ignorés).
const ORGS = [{ id: 'o1', slug: 'khelypso-cra', name: 'Khelypso CRA' }];
const PROJECTS = [
  {
    id: 'p1',
    ref: 'aaaaaaaaaaaaaaaaaaaa',
    organization_id: 'o1',
    organization_slug: 'khelypso-cra',
    name: 'API',
    region: 'eu-west-3',
    created_at: '2026-01-01T00:00:00Z',
    status: 'ACTIVE_HEALTHY',
    database: {},
  },
  {
    id: 'p2',
    ref: 'bbbbbbbbbbbbbbbbbbbb',
    organization_id: 'o1',
    organization_slug: 'khelypso-cra',
    name: 'Staging',
    region: 'eu-west-3',
    created_at: '2026-01-01T00:00:00Z',
    status: 'INACTIVE',
    database: {},
  },
];

function stubFetch(
  handler: (path: string | null, init?: RequestInit) => Response
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input.toString();
      const path = new URL(raw).searchParams.get('path');
      return Promise.resolve(handler(path, init));
    })
  );
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  patVault.disable(); // clé mémoire + métadonnées du coffre remises à zéro
  localStorage.clear();
});

describe('localRealApi — Supabase réel via proxy', () => {
  it('createAccount → testAccount/getFleet renvoient orgs + statuts des projets', async () => {
    stubFetch(path => {
      if (path === '/v1/organizations') return json(ORGS);
      if (path === '/v1/projects') return json(PROJECTS);
      return json(null, 404);
    });
    const api = createLocalRealApi(PROXY);
    const acc = await api.createAccount({
      alias: 'Khelypso',
      color: '#3ecf8e',
      pat: 'sbp_DEMOFAKEtoken',
    });

    // 1) testAccount : NOMS d'organisations + nombre de projets.
    const test = await api.testAccount(acc.id);
    expect(test.ok).toBe(true);
    expect(test.organizations).toContain('Khelypso CRA');
    expect(test.projects).toBe(2);

    // 2) getFleet : projets avec STATUT + jointure slug→nom d'organisation.
    const fleet = await api.getFleet(true);
    const af = fleet.accounts.find(a => a.account.id === acc.id);
    expect(af?.projects).toHaveLength(2);
    const apiProject = af?.projects.find(p => p.ref === 'aaaaaaaaaaaaaaaaaaaa');
    expect(apiProject?.status).toBe('ACTIVE_HEALTHY');
    expect(apiProject?.organizationName).toBe('Khelypso CRA');
    const staging = af?.projects.find(p => p.ref === 'bbbbbbbbbbbbbbbbbbbb');
    expect(staging?.status).toBe('INACTIVE');
    expect(af?.organizations).toEqual([
      { slug: 'khelypso-cra', name: 'Khelypso CRA' },
    ]);
    vi.unstubAllGlobals();
  });

  it('createAccount rejette un PAT invalide (401 du proxy)', async () => {
    stubFetch(() => json({ message: 'Unauthorized' }, 401));
    const api = createLocalRealApi(PROXY);
    await expect(
      api.createAccount({ alias: 'X', color: '#3ecf8e', pat: 'sbp_bad' })
    ).rejects.toMatchObject({ status: 401, code: 'pat-invalid' });
    // Rien n'est persisté pour un PAT refusé.
    expect(await api.listAccounts()).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('persiste le compte localement (clé dédiée, séparée de la démo)', async () => {
    stubFetch(path =>
      path === '/v1/organizations' ? json(ORGS) : json(PROJECTS)
    );
    const first = createLocalRealApi(PROXY);
    await first.createAccount({
      alias: 'Khelypso',
      color: '#3ecf8e',
      pat: 'sbp_DEMOFAKEtoken',
    });
    expect(localStorage.getItem(REAL_STORAGE_KEY)).toContain('Khelypso');
    // Mock démo intact (clés distinctes).
    expect(localStorage.getItem('miss-supaboss-mock-v1')).toBeNull();

    // Une nouvelle instance recharge le compte persisté.
    const second = createLocalRealApi(PROXY);
    expect(await second.listAccounts()).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('getFleetMetrics collecte les quotas par projet ACTIF (SQL via proxy)', async () => {
    stubFetch((path, init) => {
      if (path === '/v1/organizations') return json(ORGS);
      if (path === '/v1/projects') return json(PROJECTS);
      if (path?.endsWith('/database/query/read-only')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          query: string;
        };
        if (body.query.includes('pg_database_size'))
          return json([{ v: 200 * 1024 * 1024 }]);
        if (body.query.includes('storage.objects'))
          return json([{ v: 30 * 1024 * 1024 }]);
        if (body.query.includes('auth.users')) return json([{ v: 1200 }]);
      }
      return json(null, 404);
    });
    const api = createLocalRealApi(PROXY);
    await api.createAccount({
      alias: 'Khelypso',
      color: '#3ecf8e',
      pat: 'sbp_DEMOFAKEtoken',
    });
    await api.getFleet(true); // peuple le cache flotte
    const fm = await api.getFleetMetrics(true);

    // Projet ACTIF : db/storage mesurés, MAU estimé, egress indisponible.
    const active = fm.projects.find(p => p.ref === 'aaaaaaaaaaaaaaaaaaaa');
    const db = active?.metrics.find(m => m.kind === 'dbSize');
    expect(db?.value).toBe(200 * 1024 * 1024);
    expect(db?.state).toBe('measured');
    expect(active?.metrics.find(m => m.kind === 'mau')?.value).toBe(1200);
    expect(active?.metrics.find(m => m.kind === 'mau')?.state).toBe(
      'estimated'
    );
    expect(active?.metrics.find(m => m.kind === 'egress')?.state).toBe(
      'unavailable'
    );

    // Projet EN PAUSE : pas de collecte SQL → indisponible.
    const paused = fm.projects.find(p => p.ref === 'bbbbbbbbbbbbbbbbbbbb');
    expect(paused?.metrics.find(m => m.kind === 'dbSize')?.value).toBeNull();
    vi.unstubAllGlobals();
  });

  it('getFleetMetrics signale les échecs DURS de collecte (refreshErrors)', async () => {
    // orgs/projets OK, mais la requête SQL échoue en 401 (PAT/proxy) :
    // distinct d'une métrique « non disponible » → refreshErrors compté.
    stubFetch(path => {
      if (path === '/v1/organizations') return json(ORGS);
      if (path === '/v1/projects') return json(PROJECTS);
      if (path?.endsWith('/database/query/read-only'))
        return json({ message: 'Unauthorized' }, 401);
      return json(null, 404);
    });
    const api = createLocalRealApi(PROXY);
    await api.createAccount({
      alias: 'Khelypso',
      color: '#3ecf8e',
      pat: 'sbp_DEMOFAKEtoken',
    });
    await api.getFleet(true);
    const fm = await api.getFleetMetrics(true);

    // Seul le projet ACTIF tente la collecte → 1 échec ; le projet en pause non.
    expect(fm.refreshErrors).toBe(1);
    const active = fm.projects.find(p => p.ref === 'aaaaaaaaaaaaaaaaaaaa');
    expect(active?.metrics.find(m => m.kind === 'dbSize')?.value).toBeNull();
    vi.unstubAllGlobals();
  });

  it('favori (méta) conservé localement et fusionné à la flotte live', async () => {
    stubFetch(path =>
      path === '/v1/organizations' ? json(ORGS) : json(PROJECTS)
    );
    const api = createLocalRealApi(PROXY);
    const acc = await api.createAccount({
      alias: 'Khelypso',
      color: '#3ecf8e',
      pat: 'sbp_DEMOFAKEtoken',
    });
    await api.updateProjectMeta(acc.id, 'aaaaaaaaaaaaaaaaaaaa', {
      favorite: true,
    });
    const fleet = await api.getFleet(true);
    const p = fleet.accounts
      .flatMap(a => a.projects)
      .find(x => x.ref === 'aaaaaaaaaaaaaaaaaaaa');
    expect(p?.meta.favorite).toBe(true);
    vi.unstubAllGlobals();
  });

  it('coffre activé : PAT chiffré au repos, déverrouillage restaure la flotte', async () => {
    let lastAuth: string | null = null;
    stubFetch((path, init) => {
      const h = init?.headers as Record<string, string> | undefined;
      if (h?.authorization) lastAuth = h.authorization;
      if (path === '/v1/organizations') return json(ORGS);
      if (path === '/v1/projects') return json(PROJECTS);
      return json(null, 404);
    });
    const first = createLocalRealApi(PROXY);
    await first.createAccount({
      alias: 'Khelypso',
      color: '#3ecf8e',
      pat: 'sbp_DEMOFAKEtoken',
    });

    // Activer le chiffrement → l'état persisté ne doit plus contenir le clair.
    await first.vault?.enable('ma-phrase-secrete');
    const stored = localStorage.getItem(REAL_STORAGE_KEY) ?? '';
    expect(stored).not.toContain('sbp_DEMOFAKEtoken');
    expect(stored).toContain('patEnc');

    // Nouveau « chargement » : coffre verrouillé.
    patVault.lock();
    const reopened = createLocalRealApi(PROXY);
    expect(reopened.vault?.isEnabled()).toBe(true);
    expect(reopened.vault?.isUnlocked()).toBe(false);

    // Mauvaise phrase refusée, bonne phrase OK → PAT redéchiffré en mémoire.
    expect(await reopened.vault?.unlock('mauvaise')).toBe(false);
    expect(await reopened.vault?.unlock('ma-phrase-secrete')).toBe(true);

    const fleet = await reopened.getFleet(true);
    expect(
      fleet.accounts.find(a => a.account.alias === 'Khelypso')?.projects
    ).toHaveLength(2);
    // La requête a bien porté le PAT déchiffré (pas une chaîne vide).
    expect(lastAuth).toBe('Bearer sbp_DEMOFAKEtoken');

    patVault.disable();
    vi.unstubAllGlobals();
  });
});
