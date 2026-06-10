// @vitest-environment node
/**
 * Tests d'intégration HTTP : app Fastify réelle + provider mock + SQLite
 * en mémoire, via fastify.inject (aucun port ouvert, aucun réseau).
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

async function login(
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
  expect(cookie).toBeDefined();
  return `supaboss_session=${cookie?.value ?? ''}`;
}

const CSRF = { 'x-supaboss-csrf': '1' };

beforeEach(async () => {
  store = new Store(':memory:');
  store.createUser(
    'admin@test',
    hashPassword('le-mot-de-passe-admin'),
    'admin'
  );
  store.createUser(
    'viewer@test',
    hashPassword('le-mot-de-passe-viewer'),
    'viewer'
  );
  provider = new MockProvider();
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

describe('auth', () => {
  it('login → me → logout', async () => {
    const cookie = await login();
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { email: 'admin@test', role: 'admin' },
    });
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(out.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it('mauvais mot de passe : 401 + audit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@test', password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
    const failed = store
      .listOperations(10)
      .find(o => o.action === 'login' && o.status === 'error');
    expect(failed).toBeDefined();
  });

  it('routes protégées sans session : 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(401);
  });
});

describe('comptes', () => {
  it('création (PAT testé, chiffré, jamais renvoyé) puis flotte', async () => {
    const cookie = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie, ...CSRF },
      payload: {
        alias: 'Lab POC',
        pat: 'sbp_FAKETESTFAKETESTFAKETESTFAKETESTFAKETEST',
      },
    });
    expect(created.statusCode).toBe(201);
    const { account } = created.json() as {
      account: { id: string; patHint: string };
    };
    expect(account.patHint).toBe('sbp_…TEST');
    expect(JSON.stringify(created.json())).not.toContain('FAKETESTFAKE');

    const fleet = await app.inject({
      method: 'GET',
      url: '/api/fleet',
      headers: { cookie },
    });
    expect(fleet.statusCode).toBe(200);
    const body = fleet.json() as {
      accounts: { projects: { ref: string; status: string }[] }[];
    };
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]?.projects.length).toBeGreaterThan(2);
  });

  it('viewer ne peut pas créer de compte (403)', async () => {
    const cookie = await login('viewer@test', 'le-mot-de-passe-viewer');
    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie, ...CSRF },
      payload: { alias: 'x', pat: 'sbp_0123456789abcdef0123' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('mutation sans en-tête CSRF : 403', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie },
      payload: { alias: 'x', pat: 'sbp_0123456789abcdef0123' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('pause / restore et garde-fous', () => {
  async function setup(): Promise<{ cookie: string; accountId: string }> {
    const cookie = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie, ...CSRF },
      payload: {
        alias: 'Lab',
        pat: 'sbp_FAKETESTFAKETESTFAKETESTFAKETESTFAKETEST',
      },
    });
    const { account } = created.json() as { account: { id: string } };
    await app.inject({
      method: 'GET',
      url: '/api/fleet',
      headers: { cookie },
    });
    return { cookie, accountId: account.id };
  }

  it('restore bloqué à 2 actifs : 409 + suggestions, puis force OK', async () => {
    const { cookie, accountId } = await setup();
    // Le mock démarre avec 2 projets actifs → limite atteinte.
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/projects/${accountId}/hackathon-2026/restore`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);
    const body = blocked.json() as {
      error: string;
      assessment: { suggestions: { ref: string }[]; activeCount: number };
    };
    expect(body.error).toBe('limit-reached');
    expect(body.assessment.activeCount).toBe(2);
    expect(body.assessment.suggestions.length).toBeGreaterThan(0);

    // pauseFirst libère un slot → restauration acceptée.
    const ok = await app.inject({
      method: 'POST',
      url: `/api/projects/${accountId}/hackathon-2026/restore`,
      headers: { cookie, ...CSRF },
      payload: { pauseFirst: ['demo-crm-poc'] },
    });
    expect(ok.statusCode).toBe(202);

    const ops = store.listOperations(20);
    expect(
      ops.some(o => o.action === 'project.pause' && o.status === 'ok')
    ).toBe(true);
    expect(
      ops.some(o => o.action === 'project.restore' && o.status === 'ok')
    ).toBe(true);
  });

  it('pause d’un projet déjà en pause : 409 exploitable', async () => {
    const { cookie, accountId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${accountId}/client-pitch/pause`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('not-pausable');
  });

  it('métriques : egress indisponible, dbSize mesuré sur projet actif', async () => {
    const { cookie } = await setup();
    const res = await app.inject({
      method: 'GET',
      url: '/api/fleet/metrics',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      projects: {
        ref: string;
        metrics: { kind: string; state: string; value: number | null }[];
      }[];
    };
    const active = body.projects.find(p => p.ref === 'demo-crm-poc');
    expect(active).toBeDefined();
    const egress = active?.metrics.find(m => m.kind === 'egress');
    expect(egress?.state).toBe('unavailable');
    expect(egress?.value).toBeNull();
    const db = active?.metrics.find(m => m.kind === 'dbSize');
    expect(db?.state).toBe('measured');
    expect(db?.value).toBeGreaterThan(0);
  });
});

describe('divers', () => {
  it('health public + version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, mock: true });
  });

  it('réglages utilisateur persistés', async () => {
    const cookie = await login();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/me/settings',
      headers: { cookie },
      payload: {
        thresholds: { warn: 60, high: 80, critical: 90 },
        pollingSeconds: 30,
        restoreWindowDays: 90,
      },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({
      method: 'GET',
      url: '/api/me/settings',
      headers: { cookie },
    });
    expect(
      (get.json() as { settings: { thresholds: { warn: number } } }).settings
        .thresholds.warn
    ).toBe(60);
  });

  it('export → import chiffré (autre instance simulée par purge)', async () => {
    const cookie = await login();
    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie, ...CSRF },
      payload: {
        alias: 'Lab',
        pat: 'sbp_FAKETESTFAKETESTFAKETESTFAKETESTFAKETEST',
      },
    });
    const exported = await app.inject({
      method: 'POST',
      url: '/api/accounts/export',
      headers: { cookie, ...CSRF },
      payload: { passphrase: 'passphrase-tres-solide' },
    });
    expect(exported.statusCode).toBe(200);
    const { blob } = exported.json() as { blob: string };
    expect(blob).not.toContain('sbp_');

    // Purge puis import.
    const accounts = store.listAccounts();
    for (const a of accounts) store.deleteAccount(a.id);
    const imported = await app.inject({
      method: 'POST',
      url: '/api/accounts/import',
      headers: { cookie, ...CSRF },
      payload: { passphrase: 'passphrase-tres-solide', blob },
    });
    expect(imported.statusCode).toBe(200);
    expect((imported.json() as { imported: number }).imported).toBe(1);
    expect(store.listAccounts()[0]?.alias).toBe('Lab');
  });
});
