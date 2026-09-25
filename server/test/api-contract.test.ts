// @vitest-environment node
/**
 * Suite contractuelle `Api` — backend Fastify + MockProvider + SQLite mémoire.
 */
import { afterEach, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { MockProvider } from '../src/supabase/mock.ts';
import { generateMasterKey, hashPassword } from '../src/crypto.ts';
import { createAppContext } from '../src/context.ts';
import type { Env } from '../src/env.ts';
import {
  apiContractTests,
  scheduleContractTests,
  type ApiContractOptions,
} from '../../shared/test/apiContract.ts';
import { createInjectApi } from './injectApi.ts';

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
  syncIntervalMin: 0,
  syncMetrics: false,
  vapidSubject: 'mailto:admin@test',
  totpReset: undefined,
  webhookAllowPrivate: false,
  production: false,
};

let app: FastifyInstance;
let store: Store;
let provider: MockProvider;
let cookie: string;

async function login(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-supaboss-csrf': '1' },
    payload: { email: 'admin@test', password: 'le-mot-de-passe-admin' },
  });
  const c = res.cookies.find(x => x.name === 'supaboss_session');
  return `supaboss_session=${c?.value ?? ''}`;
}

beforeEach(async () => {
  store = new Store(':memory:');
  store.createUser(
    'admin@test',
    hashPassword('le-mot-de-passe-admin'),
    'admin'
  );
  provider = new MockProvider();
  const masterKey = generateMasterKey();
  const ctx = createAppContext({
    env: TEST_ENV,
    store,
    provider,
    masterKey,
    version: 'test',
  });
  app = await buildApp(ctx, { logger: false });
  cookie = await login();
});

afterEach(async () => {
  provider.dispose();
  await app.close();
  store.close();
});

/** Mêmes scénarios pour l'API et pour les plannings. */
const serveur: ApiContractOptions = {
  name: 'serveur (inject)',
  createApi: () => createInjectApi(app, cookie),
  prepare: async api => {
    const acc = await api.createAccount({
      alias: 'Lab',
      color: '#3ecf8e',
      pat: 'sbp_FAKETESTFAKETESTFAKETESTFAKETESTFAKETEST',
    });
    return {
      accountId: acc.id,
      pauseFirstRef: 'demo-crm-poc',
      restoreTargetRef: 'hackathon-2026',
      nonPausableRef: 'hackathon-2026',
      activeMetricsRef: 'demo-crm-poc',
    };
  },
};

apiContractTests(serveur);
scheduleContractTests(serveur);
