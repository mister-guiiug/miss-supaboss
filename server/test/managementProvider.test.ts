// @vitest-environment node
/**
 * `ManagementApiProvider` — l'adaptateur vers la vraie Management API de
 * Supabase — était couvert à 0 %. Il n'a aucune branche, donc rien ne le
 * signalait dans la métrique qui échouait ; il n'en porte pas moins trois
 * décisions qu'on ne veut pas voir changer par accident.
 *
 * 1. QUELLE requête se rejoue. `request(…, retryable)` est le dernier
 *    argument, un booléen nu : l'inverser sur `pauseProject` ferait rejouer
 *    une mise en pause, et sur `restoreProject` un redémarrage — des actions
 *    d'état, pas des lectures.
 * 2. QUELLE URL est appelée. L'en-tête du fichier promet « endpoints
 *    documentés uniquement » ; une faute de frappe dans un chemin ne se
 *    verrait qu'en production, contre un vrai compte.
 * 3. `collectMetrics` ne doit JAMAIS inventer. Une métrique indisponible vaut
 *    `null`, et `egressBytes` vaut toujours `null` faute d'endpoint documenté.
 */
import { describe, expect, it, vi } from 'vitest';
import { ManagementApiProvider } from '../src/supabase/management.ts';
import type { ResilientClient } from '../src/supabase/http.ts';

const PAT = 'sbp_secret';
const CLE = 'compte-1';

interface Appel {
  key: string;
  url: string;
  init: RequestInit;
  retryable: boolean;
}

/**
 * Un client qui n'appelle rien : il enregistre les requêtes et rend ce qu'on
 * lui a dit de rendre. `ManagementApiProvider` reçoit son client par
 * constructeur — aucun réseau n'est nécessaire pour l'éprouver.
 */
function clientEspion(reponse: (url: string) => unknown) {
  const appels: Appel[] = [];
  const http = {
    request: vi.fn(
      (key: string, url: string, init: RequestInit, retryable: boolean) => {
        appels.push({ key, url, init, retryable });
        const r = reponse(url);
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
      }
    ),
  } as unknown as ResilientClient;
  return { http, appels };
}

describe('les lectures', () => {
  it('listOrganizations appelle /v1/organizations et se rejoue', async () => {
    const { http, appels } = clientEspion(() => [
      { id: 'o1', slug: 'poc-lab', name: 'POC Lab' },
    ]);

    const orgs = await new ManagementApiProvider(http).listOrganizations(
      CLE,
      PAT
    );

    expect(orgs).toEqual([{ slug: 'poc-lab', name: 'POC Lab' }]);
    expect(appels[0]).toMatchObject({
      key: CLE,
      url: 'https://api.supabase.com/v1/organizations',
      retryable: true,
    });
    expect(appels[0]?.init.method).toBe('GET');
  });

  it('listProjects appelle /v1/projects et se rejoue', async () => {
    const { http, appels } = clientEspion(() => [
      {
        id: 'p1',
        ref: 'abc',
        name: 'Projet',
        region: 'eu-west-3',
        organization_slug: 'poc-lab',
        status: 'ACTIVE_HEALTHY',
        created_at: '2026-01-15T09:00:00.000Z',
      },
    ]);

    const projets = await new ManagementApiProvider(http).listProjects(
      CLE,
      PAT
    );

    expect(projets).toHaveLength(1);
    expect(appels[0]).toMatchObject({
      url: 'https://api.supabase.com/v1/projects',
      retryable: true,
    });
  });

  it('le PAT part en Bearer, et nulle part ailleurs', async () => {
    const { http, appels } = clientEspion(() => []);

    await new ManagementApiProvider(http).listProjects(CLE, PAT);

    const headers = appels[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${PAT}`);
    expect(headers['content-type']).toBe('application/json');
    // Ni dans l'URL, où il finirait dans les journaux d'accès.
    expect(appels[0]?.url).not.toContain(PAT);
  });
});

describe('les actions d’état ne se rejouent JAMAIS', () => {
  it.each([
    ['pauseProject', 'pause'],
    ['restoreProject', 'restore'],
  ] as const)('%s poste sur /%s sans rejeu', async (methode, segment) => {
    // `retryable: false` est la garantie : un rejeu automatique de ces deux
    // appels agirait deux fois sur un projet réel.
    const { http, appels } = clientEspion(() => undefined);

    await new ManagementApiProvider(http)[methode](CLE, PAT, 'mon-projet');

    expect(appels[0]).toMatchObject({
      url: `https://api.supabase.com/v1/projects/mon-projet/${segment}`,
      retryable: false,
    });
    expect(appels[0]?.init.method).toBe('POST');
  });

  it('la référence du projet est encodée pour l’URL', async () => {
    // Elle vient de la base, donc à terme de l'API : une référence exotique
    // ne doit pas pouvoir sortir du chemin prévu.
    const { http, appels } = clientEspion(() => undefined);

    await new ManagementApiProvider(http).pauseProject(CLE, PAT, 'a/../b');

    expect(appels[0]?.url).toBe(
      'https://api.supabase.com/v1/projects/a%2F..%2Fb/pause'
    );
  });
});

describe('collectMetrics — mesurer, jamais inventer', () => {
  const reponseSql = (valeur: unknown) => [{ v: valeur }];

  it('interroge les trois métriques en une fois, sur l’endpoint read-only', async () => {
    const { http, appels } = clientEspion(() => reponseSql(1024));

    await new ManagementApiProvider(http).collectMetrics(
      CLE,
      PAT,
      'mon-projet'
    );

    expect(appels).toHaveLength(3);
    for (const appel of appels) {
      expect(appel.url).toBe(
        'https://api.supabase.com/v1/projects/mon-projet/database/query/read-only'
      );
      // Une requête SQL n'est pas idempotente aux yeux du client : elle ne
      // se rejoue pas non plus.
      expect(appel.retryable).toBe(false);
      expect(appel.init.method).toBe('POST');
    }
    // Trois requêtes DISTINCTES — sans quoi une métrique en écraserait une
    // autre sans que le total change.
    expect(new Set(appels.map(a => a.init.body)).size).toBe(3);
  });

  it('rend les trois valeurs mesurées, et `egressBytes` toujours nul', async () => {
    // Aucun endpoint public ne documente l'egress : l'interface affiche
    // « non disponible » plutôt qu'un chiffre faux.
    const { http } = clientEspion(() => reponseSql(2048));

    const metrics = await new ManagementApiProvider(http).collectMetrics(
      CLE,
      PAT,
      'mon-projet'
    );

    expect(metrics).toMatchObject({
      dbSizeBytes: 2048,
      storageBytes: 2048,
      mau: 2048,
      egressBytes: null,
    });
    expect(() => new Date(metrics.measuredAt).toISOString()).not.toThrow();
  });

  it('une métrique qui échoue vaut null — les autres passent quand même', async () => {
    // `Promise.all` sur trois appels : sans le `catch` de `runScalar`, un
    // seul refus ferait perdre les deux autres mesures, et l'écran
    // n'afficherait plus rien du tout.
    let rendus = 0;
    const { http } = clientEspion(() =>
      rendus++ === 0
        ? new Error('permission denied for schema storage')
        : reponseSql(512)
    );

    const metrics = await new ManagementApiProvider(http).collectMetrics(
      CLE,
      PAT,
      'mon-projet'
    );

    const mesures = [metrics.dbSizeBytes, metrics.storageBytes, metrics.mau];
    expect(mesures.filter(v => v === null)).toHaveLength(1);
    expect(mesures.filter(v => v === 512)).toHaveLength(2);
  });

  it('une réponse de forme inattendue vaut null, sans lever', async () => {
    // Le format de cet endpoint est marqué Beta : il peut changer sans
    // préavis, et un écran vide vaut mieux qu'un écran cassé.
    const { http } = clientEspion(() => ({ pas: 'ce qui était prévu' }));

    const metrics = await new ManagementApiProvider(http).collectMetrics(
      CLE,
      PAT,
      'mon-projet'
    );

    expect(metrics).toMatchObject({
      dbSizeBytes: null,
      storageBytes: null,
      mau: null,
      egressBytes: null,
    });
  });
});
