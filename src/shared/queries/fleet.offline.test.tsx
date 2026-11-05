import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Api } from '../../api/types.ts';
import { createLocalRealApi } from '../../api/localRealApi.ts';
import { I18nProvider } from '../../i18n/index.ts';
import type { Snapshot } from '../../offline/lastKnown.ts';
import { allProjects, useFleetStore } from '../../store/useFleetStore.ts';
import { AppHeader } from '../components/AppHeader.tsx';
import { useFleetBootstrap } from './fleet.ts';

/**
 * CE QUE CE TEST VERROUILLE : un redémarrage HORS LIGNE montre le dernier
 * état connu, et ne l'écrase pas.
 *
 * Le défaut d'origine traversait trois fichiers, et aucun ne le voyait seul :
 * `getFleet` changeait la panne en flotte vide, la requête « réussissait »,
 * et `syncFleetToStore` enregistrait ce vide comme instantané — le repli
 * `hydrateFromCache`, branché sur l'échec, ne partait jamais. D'où un test
 * d'écran, de l'API réelle (seul `fetch` est simulé) jusqu'à l'en-tête.
 *
 * IndexedDB n'existe pas sous jsdom : l'instantané est tenu en mémoire, mais
 * la fusion (`mergeSnapshot`) reste la vraie.
 */
const lieu = vi.hoisted(() => ({
  api: null as unknown as Api,
  instantane: null as Snapshot | null,
}));

vi.mock('../../api/index.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/index.ts')>()),
  // L'API est créée PAR TEST : son état se lit au `localStorage` du moment.
  api: new Proxy({} as Api, {
    get: (_cible, nom) => lieu.api[nom as keyof Api],
  }),
}));

vi.mock('../../offline/lastKnown.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../offline/lastKnown.ts')>()),
  loadSnapshot: async () => lieu.instantane,
  saveSnapshot: async (snapshot: Snapshot) => {
    lieu.instantane = snapshot;
  },
}));

const PROXY = 'https://proxy.test/supabase-management';

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Un projet ACTIF par compte : pas de sondage `/restore` à simuler. */
function projetDe(pat: string) {
  const suffixe = pat.slice(-1).toLowerCase();
  return {
    ref: suffixe.repeat(20),
    name: `Projet ${suffixe.toUpperCase()}`,
    region: 'eu-west-3',
    status: 'ACTIVE_HEALTHY',
    inserted_at: '2026-01-01T00:00:00Z',
  };
}

/**
 * Le relais Management. `injoignables` : les PAT dont la requête ne part pas
 * — `fetch` lève, comme hors ligne. Tous, par défaut, une fois coupé.
 */
function relais(injoignables: (pat: string) => boolean = () => false) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const pat = String(
        (init?.headers as Record<string, string> | undefined)?.authorization
      ).replace('Bearer ', '');
      if (injoignables(pat)) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      const path = new URL(String(input)).searchParams.get('path') ?? '';
      if (path === '/v1/organizations') {
        return Promise.resolve(json([{ slug: 'org', name: 'Org' }]));
      }
      if (path.includes('/organizations/') && path.includes('/projects')) {
        return Promise.resolve(
          json({
            projects: [projetDe(pat)],
            pagination: { count: 1, limit: 100, offset: 0 },
          })
        );
      }
      return Promise.resolve(json(null, 404));
    })
  );
}

/** La visite précédente, EN LIGNE : comptes enregistrés, instantané plein. */
async function visitePrecedente(pats: string[]): Promise<void> {
  relais();
  const api = createLocalRealApi(PROXY);
  for (const pat of pats) {
    await api.createAccount({ alias: pat, color: '#3ecf8e', pat });
  }
  lieu.instantane = {
    fleet: await api.getFleet(true),
    metrics: null,
    savedAt: '2026-11-04T08:00:00.000Z',
  };
  vi.unstubAllGlobals();
}

function Ecran() {
  const { offlineEmpty } = useFleetBootstrap();
  const fleet = useFleetStore(s => s.fleet);
  const projets = useMemo(() => allProjects(fleet), [fleet]);
  if (offlineEmpty) return <p>écran hors ligne</p>;
  return (
    <>
      <AppHeader title="Flotte" />
      <ul>
        {projets.map(p => (
          <li key={`${p.accountId}:${p.ref}`}>{p.name}</li>
        ))}
      </ul>
    </>
  );
}

/** Le démarrage de l'app : une instance d'API neuve, donc un cache vide. */
function demarrer() {
  lieu.api = createLocalRealApi(PROXY);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <Ecran />
      </QueryClientProvider>
    </I18nProvider>
  );
}

const projetsDe = (snapshot: Snapshot | null) =>
  (snapshot?.fleet.accounts ?? []).flatMap(a => a.projects.map(p => p.name));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('supaboss_locale', 'fr');
  lieu.instantane = null;
  useFleetStore.setState({
    fleet: null,
    metrics: null,
    fromCache: false,
    cacheSavedAt: null,
    loading: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('flotte : redémarrage hors ligne', () => {
  it("montre l'instantané, daté, et ne l'écrase pas", async () => {
    await visitePrecedente(['sbp_FAKEA', 'sbp_FAKEB']);
    relais(() => true);

    demarrer();

    expect(await screen.findByText('Projet A')).toBeInTheDocument();
    expect(screen.getByText('Projet B')).toBeInTheDocument();
    // L'en-tête dit d'où vient ce qu'on voit, pas « synchro à l'instant ».
    expect(screen.getByText(/^hors ligne — état/)).toBeInTheDocument();
    expect(screen.queryByText(/^synchro/)).not.toBeInTheDocument();
    expect(projetsDe(lieu.instantane)).toEqual(['Projet A', 'Projet B']);
  });

  it("un compte injoignable garde ses projets dans l'instantané", async () => {
    await visitePrecedente(['sbp_FAKEA', 'sbp_FAKEB']);
    // Succès partiel : A répond, B non — et rien de B en mémoire.
    relais(pat => pat === 'sbp_FAKEB');

    demarrer();

    expect(await screen.findByText('Projet A')).toBeInTheDocument();
    // L'en-tête ne dit pas « synchro » tout court : un compte manque.
    expect(
      await screen.findByText(/1 compte\(s\) en échec/)
    ).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(lieu.instantane?.savedAt).not.toBe('2026-11-04T08:00:00.000Z')
    );
    expect(projetsDe(lieu.instantane)).toEqual(['Projet A', 'Projet B']);
  });

  it('sans instantané, l’écran hors ligne — pas une flotte vide', async () => {
    await visitePrecedente(['sbp_FAKEA']);
    lieu.instantane = null;
    relais(() => true);

    demarrer();

    expect(await screen.findByText('écran hors ligne')).toBeInTheDocument();
    expect(lieu.instantane).toBeNull();
  });
});
