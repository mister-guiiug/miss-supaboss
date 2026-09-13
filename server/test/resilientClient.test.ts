// @vitest-environment node
/**
 * `ResilientClient` porte tout ce qui protège le compte Supabase de
 * l'utilisateur : le budget d'appels (la Management API en documente 60 par
 * minute), le retrait exponentiel, le respect de `Retry-After`, et le
 * disjoncteur. Il était couvert à 1,36 % — zéro branche sur quarante-six.
 *
 * Ce n'était pas faute de pouvoir : la classe DÉCLARE `fetchImpl` et `sleep`
 * avec le commentaire « Injectable pour les tests ». Les points d'injection
 * étaient posés, les tests jamais écrits.
 *
 * Ce que ça coûte : un budget mal décompté fait dépasser le quota et Supabase
 * répond 429 à TOUTES les requêtes du compte ; un disjoncteur qui s'ouvre sur
 * un 404 coupe un compte sain pendant une minute ; un `Retry-After` non
 * plafonné fait attendre l'interface aussi longtemps que le serveur le
 * demande.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BudgetExceededError,
  CircuitOpenError,
  HttpError,
  ResilientClient,
  type ResilientClientOptions,
} from '../src/supabase/http.ts';

const URL_TEST = 'https://api.supabase.com/v1/projects';

/** Les durées passées à `sleep`, dans l'ordre — le retrait est observable. */
let dormi: number[];
/** Les `init` reçus par le faux `fetch`, un par tentative. */
let appels: RequestInit[];

/**
 * Un `fetch` qui débite une file de réponses. Un élément peut être une
 * `Response` (rendue) ou une valeur à rejeter (panne réseau). La file épuisée,
 * le dernier élément se répète : la plupart des cas n'ont qu'un comportement.
 */
function fauxFetch(file: readonly unknown[]): typeof fetch {
  let i = 0;
  return ((_url: string, init: RequestInit) => {
    appels.push(init);
    const item = file[Math.min(i, file.length - 1)];
    i += 1;
    return item instanceof Response
      ? Promise.resolve(item.clone())
      : Promise.reject(item);
  }) as unknown as typeof fetch;
}

function client(
  file: readonly unknown[],
  options: Partial<ResilientClientOptions> = {}
): ResilientClient {
  return new ResilientClient({
    budgetPerMin: 60,
    fetchImpl: fauxFetch(file),
    sleep: (ms: number) => {
      dormi.push(ms);
      return Promise.resolve();
    },
    ...options,
  });
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  dormi = [];
  appels = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('le chemin nominal', () => {
  it('rend le JSON de la réponse', async () => {
    const c = client([json({ projets: 3 })]);

    await expect(c.request('cpt', URL_TEST, {}, true)).resolves.toEqual({
      projets: 3,
    });
    expect(appels).toHaveLength(1);
    expect(dormi).toEqual([]);
  });

  it('un 204 ne rend rien, sans tenter de lire un corps', async () => {
    const c = client([new Response(null, { status: 204 })]);

    await expect(c.request('cpt', URL_TEST, {}, true)).resolves.toBeUndefined();
  });

  it('un 200 au corps VIDE ne rend rien non plus', async () => {
    // `JSON.parse('')` lèverait, et l'erreur serait prise pour une panne
    // réseau : l'appel partirait en retrait exponentiel au lieu de réussir.
    const c = client([new Response('', { status: 200 })]);

    await expect(c.request('cpt', URL_TEST, {}, true)).resolves.toBeUndefined();
  });

  it('la requête part avec un signal d’annulation', async () => {
    const c = client([json({})]);

    await c.request('cpt', URL_TEST, { method: 'POST' }, false);

    expect(appels[0]?.method).toBe('POST');
    expect(appels[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('le signal s’annule au bout de `timeoutMs`', async () => {
    // La garde qui empêche une requête suspendue de retenir le budget et le
    // disjoncteur indéfiniment.
    let vuSignal: AbortSignal | undefined;
    const c = new ResilientClient({
      budgetPerMin: 60,
      timeoutMs: 5,
      sleep: () => Promise.resolve(),
      fetchImpl: ((_u: string, init: RequestInit) => {
        vuSignal = init.signal ?? undefined;
        return new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('The operation was aborted'))
          );
          setTimeout(() => resolve(json({})), 1000);
        });
      }) as unknown as typeof fetch,
    });

    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toThrow(
      /aborted/
    );
    expect(vuSignal?.aborted).toBe(true);
  });
});

describe('les erreurs HTTP', () => {
  it('un 4xx lève une HttpError qui porte le statut et le corps', async () => {
    const c = client([new Response('jeton invalide', { status: 401 })]);

    const erreur = await c
      .request('cpt', URL_TEST, {}, true)
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(HttpError);
    expect(erreur).toMatchObject({
      name: 'HttpError',
      status: 401,
      body: 'jeton invalide',
    });
    expect((erreur as Error).message).toContain(URL_TEST);
  });

  it('un 4xx ne se rejoue PAS, même sur une requête idempotente', async () => {
    // Un PAT invalide ou un projet supprimé ne réussira pas mieux au
    // troisième essai : le rejouer triple la consommation du budget.
    const c = client([new Response('nope', { status: 404 })]);

    await expect(c.request('cpt', URL_TEST, {}, true)).rejects.toBeInstanceOf(
      HttpError
    );
    expect(appels).toHaveLength(1);
  });

  it('un 4xx N’OUVRE PAS le disjoncteur — ce n’est pas une panne', async () => {
    // Cinq 404 d'affilée sur un projet inexistant ne doivent pas couper le
    // compte entier : la classe compte un SUCCÈS de transport.
    const c = client([new Response('nope', { status: 404 })], {
      breakerThreshold: 3,
    });

    for (let i = 0; i < 5; i += 1) {
      await expect(
        c.request('cpt', URL_TEST, {}, false)
      ).rejects.toBeInstanceOf(HttpError);
    }

    // Le sixième appel atteint encore le réseau : le circuit est resté fermé.
    expect(appels).toHaveLength(5);
  });

  it('un 5xx ouvre le disjoncteur au bout de `breakerThreshold`', async () => {
    const c = client([new Response('boum', { status: 500 })], {
      breakerThreshold: 3,
    });

    for (let i = 0; i < 3; i += 1) {
      await expect(
        c.request('cpt', URL_TEST, {}, false)
      ).rejects.toBeInstanceOf(HttpError);
    }

    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeInstanceOf(
      CircuitOpenError
    );
    // Le quatrième appel n'a PAS touché le réseau.
    expect(appels).toHaveLength(3);
  });
});

describe('429 et 503 — le seul cas qui se rejoue sur réponse', () => {
  it('respecte `Retry-After` puis réussit', async () => {
    const c = client([
      new Response('trop vite', {
        status: 429,
        headers: { 'retry-after': '2' },
      }),
      json({ ok: true }),
    ]);

    await expect(c.request('cpt', URL_TEST, {}, true)).resolves.toEqual({
      ok: true,
    });
    // Deux attentes : celle du `Retry-After`, puis le retrait du tour suivant.
    expect(dormi[0]).toBe(2000);
    expect(appels).toHaveLength(2);
  });

  it('plafonne `Retry-After` à trente secondes', async () => {
    // Un serveur qui demande une heure ne doit pas geler l'interface pour
    // autant : on réessaie plus tôt, quitte à reprendre un 429.
    const c = client([
      new Response('', { status: 503, headers: { 'retry-after': '3600' } }),
      json({ ok: true }),
    ]);

    await c.request('cpt', URL_TEST, {}, true);

    expect(dormi[0]).toBe(30_000);
  });

  it('sans en-tête `Retry-After`, n’attend pas', async () => {
    const c = client([new Response('', { status: 503 }), json({ ok: true })]);

    await c.request('cpt', URL_TEST, {}, true);

    expect(dormi[0]).toBe(0);
  });

  it('ne se rejoue pas sur une requête NON idempotente', async () => {
    // Rejouer un POST de mise en pause pourrait le jouer deux fois.
    const c = client([new Response('', { status: 429 })]);

    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toMatchObject({
      status: 429,
    });
    expect(appels).toHaveLength(1);
  });

  it('après la dernière tentative, lève et compte un échec', async () => {
    const c = client([new Response('encore', { status: 429 })], {
      maxRetries: 1,
      breakerThreshold: 1,
    });

    await expect(c.request('cpt', URL_TEST, {}, true)).rejects.toMatchObject({
      status: 429,
      body: 'encore',
    });
    expect(appels).toHaveLength(2); // maxRetries 1 → deux tentatives

    // L'échec a bien été compté : le circuit est ouvert.
    await expect(c.request('cpt', URL_TEST, {}, true)).rejects.toBeInstanceOf(
      CircuitOpenError
    );
  });
});

describe('les pannes réseau', () => {
  it('se rejouent en retrait exponentiel dispersé', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const c = client([new TypeError('fetch failed'), json({ ok: true })], {
      maxRetries: 2,
    });

    await expect(c.request('cpt', URL_TEST, {}, true)).resolves.toEqual({
      ok: true,
    });
    // 300 × 2⁰ = 300, plus un jitter de floor(0,5 × 150) = 75.
    expect(dormi).toEqual([375]);
  });

  it('le retrait double à chaque tour', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const c = client([new TypeError('fetch failed')], { maxRetries: 2 });

    await expect(c.request('cpt', URL_TEST, {}, true)).rejects.toThrow(
      'fetch failed'
    );
    expect(dormi).toEqual([300, 600]);
    expect(appels).toHaveLength(3);
  });

  it('ne se rejouent pas sur une requête NON idempotente', async () => {
    const c = client([new TypeError('fetch failed')]);

    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toThrow(
      'fetch failed'
    );
    expect(appels).toHaveLength(1);
    expect(dormi).toEqual([]);
  });

  it('un rejet qui n’est pas une Error devient une Error nommée', async () => {
    // Sans ce repli, l'appelant recevrait une chaîne nue, et le `catch` du
    // routeur — qui lit `error.message` — afficherait « undefined ».
    const c = client(['panne opaque']);

    const erreur = await c
      .request('cpt', URL_TEST, {}, false)
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(Error);
    expect((erreur as Error).message).toBe('Erreur réseau inconnue');
  });
});

describe('le budget d’appels', () => {
  it('laisse passer exactement `budgetPerMin` appels par minute', async () => {
    const c = client([json({})], { budgetPerMin: 3 });

    for (let i = 0; i < 3; i += 1) {
      await c.request('cpt', URL_TEST, {}, false);
    }

    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeInstanceOf(
      BudgetExceededError
    );
    expect(appels).toHaveLength(3);
  });

  it('la fenêtre repart après une minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
    const c = client([json({})], { budgetPerMin: 1 });

    await c.request('cpt', URL_TEST, {}, false);
    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeInstanceOf(
      BudgetExceededError
    );

    vi.setSystemTime(new Date('2026-09-13T12:01:00Z'));

    await expect(c.request('cpt', URL_TEST, {}, false)).resolves.toBeDefined();
  });

  it('chaque compte a SON budget', async () => {
    // La limite est documentée par organisation Supabase : un compte saturé
    // ne doit pas bloquer les autres, c'est tout l'intérêt de la clé.
    const c = client([json({})], { budgetPerMin: 1 });

    await c.request('compteA', URL_TEST, {}, false);
    await expect(
      c.request('compteA', URL_TEST, {}, false)
    ).rejects.toBeInstanceOf(BudgetExceededError);

    await expect(
      c.request('compteB', URL_TEST, {}, false)
    ).resolves.toBeDefined();
  });

  it('un rejeu consomme lui aussi du budget', async () => {
    // Sinon une salve d'erreurs réseau multiplierait par trois les appels
    // réels sans que le compteur s'en aperçoive.
    const c = client([new TypeError('fetch failed'), json({ ok: true })], {
      budgetPerMin: 2,
      maxRetries: 2,
    });

    await c.request('cpt', URL_TEST, {}, true); // 2 tentatives = 2 unités

    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeInstanceOf(
      BudgetExceededError
    );
  });
});

describe('le disjoncteur', () => {
  it('se referme après le temps de refroidissement', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
    const c = client([new Response('boum', { status: 500 })], {
      breakerThreshold: 1,
      breakerCooldownMs: 60_000,
      budgetPerMin: 60,
    });

    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeInstanceOf(
      HttpError
    );
    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeInstanceOf(
      CircuitOpenError
    );

    vi.setSystemTime(new Date('2026-09-13T12:01:01Z'));

    // Demi-ouvert : l'appel repart vers le réseau (et échoue de nouveau, mais
    // c'est le réseau qui le dit, plus le disjoncteur).
    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeInstanceOf(
      HttpError
    );
  });

  it('un succès remet le compteur d’échecs à zéro', async () => {
    // Deux échecs, un succès, deux échecs : sans la remise à zéro, le
    // quatrième ouvrirait le circuit d'un compte qui répond.
    const panne = new Response('boum', { status: 500 });
    const c = client(
      [panne, panne, json({ ok: true }), panne, panne, json({ fin: true })],
      { breakerThreshold: 3 }
    );

    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeTruthy();
    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeTruthy();
    await expect(c.request('cpt', URL_TEST, {}, false)).resolves.toEqual({
      ok: true,
    });
    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeTruthy();
    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeTruthy();

    await expect(c.request('cpt', URL_TEST, {}, false)).resolves.toEqual({
      fin: true,
    });
  });

  it('le circuit est propre à un compte', async () => {
    const c = client([new Response('boum', { status: 500 })], {
      breakerThreshold: 1,
    });

    await expect(
      c.request('compteA', URL_TEST, {}, false)
    ).rejects.toBeInstanceOf(HttpError);
    await expect(
      c.request('compteA', URL_TEST, {}, false)
    ).rejects.toBeInstanceOf(CircuitOpenError);

    await expect(
      c.request('compteB', URL_TEST, {}, false)
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('les messages nomment le compte concerné', async () => {
    // Ils remontent jusqu'à l'écran : « réessayez dans une minute » sans
    // dire lequel des comptes est en cause n'aide personne.
    const c = client([new Response('boum', { status: 500 })], {
      breakerThreshold: 1,
      budgetPerMin: 2,
    });

    await expect(c.request('prod', URL_TEST, {}, false)).rejects.toBeTruthy();
    await expect(c.request('prod', URL_TEST, {}, false)).rejects.toThrow(
      /prod/
    );

    const budget = client([json({})], { budgetPerMin: 1 });
    await budget.request('recette', URL_TEST, {}, false);
    await expect(
      budget.request('recette', URL_TEST, {}, false)
    ).rejects.toThrow(/recette/);
  });

  it('le premier appel d’une fenêtre passe toujours, budget nul compris', async () => {
    // `consumeBudget` ouvre la fenêtre à `count: 1` sans confronter la
    // limite : le plancher réel est donc UN appel par minute, jamais zéro.
    //
    // Sans conséquence en exploitation — `env.ts` contraint
    // `SUPABOSS_API_BUDGET_PER_MIN` à `.min(1).max(60)`, un budget nul est
    // donc inatteignable. Le comportement est fixé ici pour que ce lien
    // entre les deux fichiers ne se perde pas.
    const c = client([json({ ok: true })], { budgetPerMin: 0 });

    await expect(c.request('cpt', URL_TEST, {}, false)).resolves.toEqual({
      ok: true,
    });
    await expect(c.request('cpt', URL_TEST, {}, false)).rejects.toBeInstanceOf(
      BudgetExceededError
    );
  });
});
