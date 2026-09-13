// @vitest-environment node
/**
 * Les CHEMINS D'ERREUR des routes `/api/accounts`, couvertes à 4,54 % de
 * branches — la plus mauvaise du dépôt. `api.test.ts` éprouve les parcours
 * heureux ; ici on éprouve tout ce qui rate, c'est-à-dire ce que l'utilisateur
 * rencontre vraiment : un PAT refusé, un compte déjà supprimé, une passphrase
 * mal retapée.
 *
 * Ces routes manipulent des PAT Supabase — un secret qui donne le contrôle de
 * tous les projets d'une organisation. Deux garanties comptent plus que les
 * autres, et sont vérifiées ici : un PAT refusé n'enregistre RIEN, et rien de
 * ce qui sort de l'API ne contient le secret en clair.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { FleetService } from '../src/fleet.ts';
import { MockProvider } from '../src/supabase/mock.ts';
import { generateMasterKey, hashPassword } from '../src/crypto.ts';
import type { AppContext } from '../src/context.ts';
import type { Env } from '../src/env.ts';
import type { RawOrganization, RawProject } from '../src/supabase/provider.ts';

const TEST_ENV: Env = {
  port: 0,
  host: '127.0.0.1',
  dataDir: ':memory:',
  masterKey: undefined,
  adminEmail: 'admin@test',
  adminPassword: undefined,
  mock: true,
  secureCookies: false,
  apiBudgetPerMin: 50,
  production: false,
};

const CSRF = { 'x-supaboss-csrf': '1' };

/**
 * De faux PAT, qui satisfont `accountCreateBodySchema` (préfixe `sbp_`, vingt
 * caractères au moins) SANS ressembler à un vrai.
 *
 * La première version de ce fichier employait `sbp_` suivi de quarante
 * caractères hexadécimaux — la forme exacte d'un jeton Supabase. La protection
 * anti-secrets de GitHub a refusé la poussée, et elle avait raison : un
 * scanner ne peut pas distinguer un faux jeton bien formé d'un vrai. Les
 * tirets suffisent à lever l'ambiguïté, et ne changent rien à ce qui est
 * éprouvé ici.
 */
const PAT = 'sbp_faux-jeton-de-test-numero-un';
const AUTRE_PAT = 'sbp_faux-jeton-de-test-numero-deux';

/**
 * Le fournisseur mock, mais qui peut refuser à la demande — c'est le seul
 * moyen d'éprouver ce que fait l'application d'un PAT invalide, et le mock
 * seul ne rate jamais.
 */
class ProviderRefusant extends MockProvider {
  /** Ce qui sera levé au prochain appel. `null` = tout va bien. */
  refus: unknown = null;

  override async listOrganizations(): Promise<RawOrganization[]> {
    if (this.refus !== null) throw this.refus;
    return super.listOrganizations();
  }

  override async listProjects(): Promise<RawProject[]> {
    if (this.refus !== null) throw this.refus;
    return super.listProjects();
  }
}

let app: FastifyInstance;
let store: Store;
let provider: ProviderRefusant;

async function connexion(
  email = 'admin@test',
  password = 'le-mot-de-passe-admin'
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find(c => c.name === 'supaboss_session');
  return `supaboss_session=${cookie?.value ?? ''}`;
}

/** Crée un compte par l'API et rend son identifiant. */
async function creerCompte(cookie: string, alias = 'prod'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: { cookie, ...CSRF },
    payload: { alias, pat: PAT, color: '#112233' },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { account: { id: string } }).account.id;
}

const operations = () =>
  store.listOperations(50) as Array<{
    action: string;
    status: string;
    detail?: string | null;
  }>;

beforeEach(async () => {
  store = new Store(':memory:');
  store.createUser(
    'admin@test',
    hashPassword('le-mot-de-passe-admin'),
    'admin'
  );
  provider = new ProviderRefusant();
  const masterKey = generateMasterKey();
  const ctx: AppContext = {
    env: TEST_ENV,
    store,
    fleet: new FleetService(store, provider, masterKey),
    masterKey,
    version: 'test',
  };
  app = await buildApp(ctx, { logger: false });
});

afterEach(async () => {
  provider.dispose();
  await app.close();
  store.close();
});

describe('POST /api/accounts — un PAT refusé n’enregistre rien', () => {
  it('répond 422, et le compte n’est PAS créé', async () => {
    // Le test de connectivité passe AVANT l'enregistrement, exprès :
    // un PAT invalide enregistré ferait un compte en erreur permanente que
    // l'utilisateur croirait configuré.
    const cookie = await connexion();
    provider.refus = new Error('Invalid authentication credentials');

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie, ...CSRF },
      payload: { alias: 'prod', pat: PAT, color: '#112233' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'pat-invalid' });
    expect(store.listAccounts()).toHaveLength(0);
  });

  it('le motif du refus remonte jusqu’au message', async () => {
    const cookie = await connexion();
    provider.refus = new Error('Invalid authentication credentials');

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie, ...CSRF },
      payload: { alias: 'prod', pat: PAT, color: '#112233' },
    });

    expect((res.json() as { message: string }).message).toContain(
      'Invalid authentication credentials'
    );
  });

  it('l’échec est tracé à l’audit', async () => {
    const cookie = await connexion();
    provider.refus = new Error('PAT révoqué');

    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie, ...CSRF },
      payload: { alias: 'prod', pat: PAT, color: '#112233' },
    });

    expect(operations()).toContainEqual(
      expect.objectContaining({ action: 'account.create', status: 'error' })
    );
  });

  it('un refus qui n’est pas une Error reste lisible', async () => {
    // Un SDK ou un `throw` mal typé peut rejeter autre chose qu'une Error.
    // Sans le repli `String(error)`, le message afficherait « undefined ».
    const cookie = await connexion();
    provider.refus = 'refus opaque du fournisseur';

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie, ...CSRF },
      payload: { alias: 'prod', pat: PAT, color: '#112233' },
    });

    expect(res.statusCode).toBe(422);
    expect((res.json() as { message: string }).message).toContain(
      'refus opaque du fournisseur'
    );
  });
});

describe('PATCH /api/accounts/:id — champ par champ', () => {
  it('ne modifie QUE le champ transmis', async () => {
    const cookie = await connexion();
    const id = await creerCompte(cookie);
    const avant = store.getAccount(id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${id}`,
      headers: { cookie, ...CSRF },
      payload: { alias: 'production' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      account: { alias: 'production', color: '#112233', enabled: true },
    });
    // Le PAT n'était pas dans le corps : son chiffré ne doit pas bouger.
    expect(store.getAccount(id)?.patCipher).toBe(avant?.patCipher);
  });

  it.each([
    ['color', { color: '#abcdef' }, { color: '#abcdef' }],
    ['enabled', { enabled: false }, { enabled: false }],
  ])('%s se met à jour seul', async (_champ, corps, attendu) => {
    const cookie = await connexion();
    const id = await creerCompte(cookie);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${id}`,
      headers: { cookie, ...CSRF },
      payload: corps,
    });

    expect(res.statusCode).toBe(200);
    expect(
      (res.json() as { account: Record<string, unknown> }).account
    ).toMatchObject(attendu);
  });

  it('la rotation du PAT rechiffre ET rafraîchit l’indice, sans jamais le renvoyer', async () => {
    const cookie = await connexion();
    const id = await creerCompte(cookie);
    const avant = store.getAccount(id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${id}`,
      headers: { cookie, ...CSRF },
      payload: { pat: AUTRE_PAT },
    });

    expect(res.statusCode).toBe(200);
    const apres = store.getAccount(id);
    expect(apres?.patCipher).not.toBe(avant?.patCipher);
    expect(apres?.patHint).not.toBe(avant?.patHint);
    // La garantie qui compte : le secret ne sort pas de l'API.
    expect(res.body).not.toContain(AUTRE_PAT);
  });

  it('un identifiant inconnu répond 404', async () => {
    const cookie = await connexion();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/accounts/ce-compte-nexiste-pas',
      headers: { cookie, ...CSRF },
      payload: { alias: 'peu importe' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not-found' });
  });
});

describe('DELETE /api/accounts/:id', () => {
  it('supprime, et trace l’alias du compte parti', async () => {
    const cookie = await connexion();
    const id = await creerCompte(cookie, 'a-supprimer');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${id}`,
      headers: { cookie, ...CSRF },
    });

    expect(res.statusCode).toBe(200);
    expect(store.listAccounts()).toHaveLength(0);
    expect(operations()).toContainEqual(
      expect.objectContaining({ action: 'account.delete', status: 'ok' })
    );
  });

  it('une seconde suppression répond 404 plutôt que « ok »', async () => {
    // Un double clic ne doit pas faire croire à deux suppressions réussies.
    const cookie = await connexion();
    const id = await creerCompte(cookie);
    await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${id}`,
      headers: { cookie, ...CSRF },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${id}`,
      headers: { cookie, ...CSRF },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/accounts/:id/test', () => {
  it('un compte inconnu répond 404', async () => {
    const cookie = await connexion();

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts/inconnu/test',
      headers: { cookie, ...CSRF },
    });

    expect(res.statusCode).toBe(404);
  });

  it('un succès enregistre la date de synchronisation', async () => {
    const cookie = await connexion();
    const id = await creerCompte(cookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/accounts/${id}/test`,
      headers: { cookie, ...CSRF },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(store.getAccount(id)?.lastSyncAt).toBeTruthy();
    expect(store.getAccount(id)?.lastError).toBeFalsy();
  });

  it('un échec répond 502 et INSCRIT le motif sur le compte', async () => {
    // C'est ce motif que l'écran affiche à côté du compte : sans lui,
    // l'utilisateur voit un compte en erreur sans savoir laquelle.
    const cookie = await connexion();
    const id = await creerCompte(cookie);
    provider.refus = new Error('Invalid authentication credentials');

    const res = await app.inject({
      method: 'POST',
      url: `/api/accounts/${id}/test`,
      headers: { cookie, ...CSRF },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'test-failed' });
    expect(store.getAccount(id)?.lastError).toContain(
      'Invalid authentication credentials'
    );
    expect(operations()).toContainEqual(
      expect.objectContaining({ action: 'account.test', status: 'error' })
    );
  });

  it('un refus non-Error reste lisible', async () => {
    const cookie = await connexion();
    const id = await creerCompte(cookie);
    provider.refus = 42;

    const res = await app.inject({
      method: 'POST',
      url: `/api/accounts/${id}/test`,
      headers: { cookie, ...CSRF },
    });

    expect(res.statusCode).toBe(502);
    expect((res.json() as { message: string }).message).toBe('42');
  });
});

describe('export / import chiffré', () => {
  async function exporter(cookie: string, passphrase: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts/export',
      headers: { cookie, ...CSRF },
      payload: { passphrase },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { blob: string; count: number };
  }

  it('une passphrase incorrecte répond 422, sans rien importer', async () => {
    const cookie = await connexion();
    await creerCompte(cookie, 'prod');
    const { blob } = await exporter(cookie, 'la-bonne-passphrase');
    const avant = store.listAccounts().length;

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts/import',
      headers: { cookie, ...CSRF },
      payload: { passphrase: 'une-autre-passphrase', blob },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'import-invalid' });
    expect(store.listAccounts()).toHaveLength(avant);
  });

  it('un blob qui n’en est pas un répond 422 au lieu de casser', async () => {
    const cookie = await connexion();

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts/import',
      headers: { cookie, ...CSRF },
      payload: { passphrase: 'la-bonne-passphrase', blob: 'pas-un-blob' },
    });

    expect(res.statusCode).toBe(422);
  });

  it('un alias déjà présent est IGNORÉ, pas dupliqué', async () => {
    // Réimporter le même fichier deux fois ne doit pas faire deux comptes
    // « prod » : l'utilisateur ne saurait plus lequel est le bon.
    const cookie = await connexion();
    await creerCompte(cookie, 'prod');
    const { blob, count } = await exporter(cookie, 'la-bonne-passphrase');

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts/import',
      headers: { cookie, ...CSRF },
      payload: { passphrase: 'la-bonne-passphrase', blob },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 0, total: count });
    expect(store.listAccounts()).toHaveLength(1);
    expect(operations()).toContainEqual(
      expect.objectContaining({ action: 'config.import', status: 'ok' })
    );
  });

  it('l’export ne laisse aucun PAT en clair dans sa réponse', async () => {
    const cookie = await connexion();
    await creerCompte(cookie, 'prod');

    const { blob } = await exporter(cookie, 'la-bonne-passphrase');

    expect(blob).not.toContain(PAT);
    expect(blob).not.toContain('sbp_');
  });
});
