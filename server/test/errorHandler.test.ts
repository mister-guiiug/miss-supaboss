// @vitest-environment node
/**
 * Le gestionnaire d'erreurs de `buildApp` — et surtout ce qu'il rend au client
 * quand la requête est REFUSÉE plutôt que quand le serveur tombe.
 *
 * Il rabattait en 500 toute erreur portant un statut autre que 429. Une
 * traversée de chemin, que `@fastify/static` refuse pourtant proprement en
 * 403, ressortait donc en « Erreur interne » — un statut faux, et une entrée
 * de journal en niveau `error` pour une requête malformée. Ces tests figent le
 * bon comportement : le vrai statut au client, le 500 réservé aux vraies
 * pannes, et jamais de détail interne dans le corps.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { FleetService } from '../src/fleet.ts';
import { MockProvider } from '../src/supabase/mock.ts';
import { generateMasterKey } from '../src/crypto.ts';
import type { AppContext } from '../src/context.ts';
import type { Env } from '../src/env.ts';

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

let app: FastifyInstance;
let store: Store;
let provider: MockProvider;
let staticDir: string;

/** Un build front minimal sur disque — `buildApp` n'enregistre
 * `@fastify/static` que si le dossier EXISTE (`existsSync`). */
function dossierStatiqueJetable(): string {
  const dir = mkdtempSync(join(tmpdir(), 'supaboss-static-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
  return dir;
}

beforeEach(async () => {
  store = new Store(':memory:');
  provider = new MockProvider();
  const masterKey = generateMasterKey();
  const ctx: AppContext = {
    env: TEST_ENV,
    store,
    fleet: new FleetService(store, provider, masterKey),
    masterKey,
    version: 'test',
  };
  staticDir = dossierStatiqueJetable();
  app = await buildApp(ctx, { logger: false, staticDir });

  // Deux routes de sonde, pour éprouver le TRI du gestionnaire sans dépendre
  // d'un plugin : l'une refuse, l'autre tombe.
  app.get('/test-refus', async () => {
    throw Object.assign(new Error('chemin /etc/passwd hors racine'), {
      statusCode: 403,
    });
  });
  app.get('/test-panne', async () => {
    throw new Error('base de données injoignable');
  });
  app.get('/test-429', async () => {
    throw Object.assign(new Error('quota atteint'), { statusCode: 429 });
  });
});

afterEach(async () => {
  provider.dispose();
  await app.close();
  store.close();
  rmSync(staticDir, { recursive: true, force: true });
});

describe('gestionnaire d’erreurs : statut rendu', () => {
  it('rend le 403 d’une requête refusée, pas un 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/test-refus' });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: 'forbidden',
      message: 'Accès refusé',
    });
  });

  it('garde le 500 pour une vraie panne', async () => {
    const res = await app.inject({ method: 'GET', url: '/test-panne' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: 'internal',
      message: 'Erreur interne',
    });
  });

  it('ne laisse fuir aucun détail interne dans le corps', async () => {
    const refus = await app.inject({ method: 'GET', url: '/test-refus' });
    const panne = await app.inject({ method: 'GET', url: '/test-panne' });

    // Les deux erreurs portent un message parlant côté serveur ; aucun des
    // deux ne doit atteindre le client.
    expect(refus.body).not.toContain('/etc/passwd');
    expect(panne.body).not.toContain('base de données');
    expect(panne.body).not.toContain('stack');
  });

  it('garde le corps dédié du 429, que la branche 4xx aurait avalé', async () => {
    // 429 est un 4xx : sans son traitement dédié, évalué AVANT, la nouvelle
    // branche générique le rendrait avec un code `client-error` quelconque.
    const res = await app.inject({ method: 'GET', url: '/test-429' });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      error: 'rate-limited',
      message: 'Trop de requêtes',
    });
  });

  it('rend 400 sur un corps JSON illisible, pas un 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{ ceci nest pas du json',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-request' });
  });
});

/**
 * `app.inject` NORMALISE le chemin : `/../package.json` y devient
 * `/package.json` et retombe sur le repli SPA — la traversée n'atteint donc
 * jamais `@fastify/static`, et un test par `inject` ne prouverait rien. Il
 * faut une vraie socket, avec un chemin envoyé tel quel.
 */
function getBrut(
  port: number,
  path: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET' },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => (body += c));
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('gestionnaire d’erreurs : traversée de chemin réelle', () => {
  let port: number;

  beforeEach(async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const adresse = app.server.address();
    if (adresse === null || typeof adresse === 'string') {
      throw new Error('adresse d’écoute inattendue');
    }
    port = adresse.port;
  });

  it('refuse une traversée en 403, pas en 500', async () => {
    const res = await getBrut(port, '/../package.json');

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: 'forbidden',
      message: 'Accès refusé',
    });
  });

  it('ne sert jamais un fichier hors de la racine statique', async () => {
    for (const chemin of [
      '/../package.json',
      '/../../package.json',
      '/assets/../../package.json',
      '/%2e%2e/%2e%2e/server/src/crypto.ts',
    ]) {
      const res = await getBrut(port, chemin);

      expect(res.statusCode).toBeLessThan(500);
      expect(res.body).not.toContain('miss-supaboss');
      expect(res.body).not.toContain('generateMasterKey');
    }
  });

  it('sert toujours le build front sur une route normale', async () => {
    const res = await getBrut(port, '/index.html');

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<!doctype html>');
  });
});
