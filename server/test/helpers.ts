/**
 * Banc d'essai commun aux tests des évolutions (2FA, plannings, alertes) :
 * l'app Fastify réelle, SQLite en mémoire, le fournisseur mock, un `fetch`
 * FACTICE — aucune notification ne quitte la machine — et un DNS FACTICE :
 * la garde anti-SSRF résout chaque hôte, et aucune question ne doit partir
 * vers un vrai résolveur.
 */
import { expect } from 'vitest';
import {
  createDecipheriv,
  createECDH,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { MockProvider } from '../src/supabase/mock.ts';
import { generateMasterKey, hashPassword } from '../src/crypto.ts';
import { createAppContext, type AppContext } from '../src/context.ts';
import type { Env } from '../src/env.ts';
import type {
  HostResolver,
  ResolvedAddress,
} from '../src/notify/destination.ts';

export const TEST_ENV: Env = {
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

export const CSRF = { 'x-supaboss-csrf': '1' };

/**
 * Un navigateur abonné de test : sa paire ECDH, son secret d'authentification
 * et SON déchiffrement (RFC 8291 / 8188), écrit ici indépendamment du code
 * du serveur — c'est ce qui en fait une vérification.
 */
export function fakeBrowser(endpoint = 'https://push.example.test/abo/42') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const subscription = {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    },
  };
  const decrypt = (body: Buffer): string => {
    const salt = body.subarray(0, 16);
    const rs = body.readUInt32BE(16);
    const idlen = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen);
    expect(rs).toBe(4096);
    const secret = ecdh.computeSecret(asPublic);
    const info = Buffer.concat([
      Buffer.from('WebPush: info\0'),
      ecdh.getPublicKey(),
      asPublic,
    ]);
    const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
    const derive = (label: string, length: number) =>
      Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(label), length));
    const decipher = createDecipheriv(
      'aes-128-gcm',
      derive('Content-Encoding: aes128gcm\0', 16),
      derive('Content-Encoding: nonce\0', 12)
    );
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plain = Buffer.concat([
      decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
      decipher.final(),
    ]);
    expect(plain[plain.length - 1]).toBe(0x02); // dernier enregistrement
    return plain.subarray(0, plain.length - 1).toString('utf8');
  };
  return {
    subscription,
    target: {
      endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    decrypt,
  };
}

export const PASSWORDS = {
  'admin@test': 'le-mot-de-passe-admin',
  'operator@test': 'le-mot-de-passe-operator',
  'viewer@test': 'le-mot-de-passe-viewer',
} as const;

export type TestEmail = keyof typeof PASSWORDS;

/** Une requête sortante capturée par le faux réseau. */
export interface SentRequest {
  url: string;
  init: RequestInit;
}

/**
 * Faux réseau : chaque appel est consigné, et la réponse vient de `respond`
 * (201 par défaut, ce que rend un service push qui accepte).
 */
export class FakeNetwork {
  readonly sent: SentRequest[] = [];
  respond: (req: SentRequest) => Response | Promise<Response> = () =>
    new Response(null, { status: 201 });

  readonly fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const req = { url: String(input), init };
    this.sent.push(req);
    return this.respond(req);
  }) as unknown as typeof fetch;
}

/**
 * Adresse PUBLIQUE rendue pour les noms `*.test` (RFC 6761 : ils ne résolvent
 * jamais pour de vrai). Celle, historique, d'example.com — aucune connexion
 * n'est tentée, le `fetch` étant factice. Pas une adresse de documentation :
 * la garde les refuse, à juste titre.
 */
export const PUBLIC_TEST_IP = '93.184.216.34';

/**
 * DNS factice : `records` d'abord (nom → adresses), sinon `*.test` →
 * `PUBLIC_TEST_IP`, `localhost` → boucle locale, et tout le reste
 * `ENOTFOUND`. Chaque question est consignée dans `asked`.
 */
export class FakeResolver {
  readonly records = new Map<string, string[]>();
  readonly asked: string[] = [];

  readonly resolve: HostResolver = async hostname => {
    this.asked.push(hostname);
    const addresses =
      this.records.get(hostname) ??
      (hostname === 'localhost'
        ? ['127.0.0.1', '::1']
        : hostname.endsWith('.test')
          ? [PUBLIC_TEST_IP]
          : null);
    if (!addresses) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
        code: 'ENOTFOUND',
      });
    }
    return addresses.map((address): ResolvedAddress => ({
      address,
      family: address.includes(':') ? 6 : 4,
    }));
  };
}

export interface TestServer {
  app: FastifyInstance;
  store: Store;
  provider: MockProvider;
  ctx: AppContext;
  net: FakeNetwork;
  dns: FakeResolver;
  masterKey: string;
  errors: unknown[];
  /** Ouvre une session et rend l'en-tête `cookie`. */
  login: (email?: TestEmail) => Promise<string>;
  /** Ajoute le compte mock et synchronise la flotte ; rend son id. */
  addAccount: (cookie: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function startTestServer(
  options: { store?: Store; masterKey?: string; env?: Partial<Env> } = {}
): Promise<TestServer> {
  const store = options.store ?? new Store(':memory:');
  for (const [email, password] of Object.entries(PASSWORDS)) {
    if (!store.findUserByEmail(email)) {
      const role = email.split('@')[0] as 'admin' | 'operator' | 'viewer';
      store.createUser(email, hashPassword(password), role);
    }
  }
  const provider = new MockProvider();
  const masterKey = options.masterKey ?? generateMasterKey();
  const net = new FakeNetwork();
  const dns = new FakeResolver();
  const errors: unknown[] = [];
  const ctx = createAppContext({
    env: { ...TEST_ENV, ...options.env },
    store,
    provider,
    masterKey,
    version: 'test',
    fetchImpl: net.fetch,
    resolver: dns.resolve,
    onError: error => errors.push(error),
  });
  const app = await buildApp(ctx, { logger: false });

  const login = async (email: TestEmail = 'admin@test'): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF,
      payload: { email, password: PASSWORDS[email] },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find(c => c.name === 'supaboss_session');
    expect(cookie).toBeDefined();
    return `supaboss_session=${cookie?.value ?? ''}`;
  };

  const addAccount = async (cookie: string): Promise<string> => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie, ...CSRF },
      payload: { alias: 'Lab', pat: 'sbp_faux-jeton-de-test-numero-un' },
    });
    expect(created.statusCode).toBe(201);
    const { account } = created.json() as { account: { id: string } };
    const fleet = await app.inject({
      method: 'GET',
      url: '/api/fleet',
      headers: { cookie },
    });
    expect(fleet.statusCode).toBe(200);
    return account.id;
  };

  const close = async (): Promise<void> => {
    await ctx.alerts.idle();
    provider.dispose();
    await app.close();
    if (!options.store) store.close();
  };

  return {
    app,
    store,
    provider,
    ctx,
    net,
    dns,
    masterKey,
    errors,
    login,
    addAccount,
    close,
  };
}
