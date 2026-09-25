// @vitest-environment node
/**
 * Double authentification, de bout en bout par `fastify.inject` :
 * enrôlement, connexion en deux temps, rejeu, codes de secours, erreurs.
 *
 * Ce qui compte le plus, et qui est vérifié ici : avec la 2FA active, un mot
 * de passe juste ne donne AUCUNE session, et un code déjà accepté ne rouvre
 * pas une seconde porte.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareServer } from '../src/boot.ts';
import { openSecret } from '../src/crypto.ts';
import { totpCode } from '../src/totp.ts';
import {
  CSRF,
  PASSWORDS,
  startTestServer,
  TEST_ENV,
  type TestEmail,
  type TestServer,
} from './helpers.ts';

let t: TestServer;

beforeEach(async () => {
  t = await startTestServer();
});

afterEach(async () => {
  await t.close();
});

/** Code du pas courant (+ `steps` pas) pour un secret base32. */
const codeFor = (secret: string, steps = 0): string =>
  totpCode(secret, Date.now() + steps * 30_000);

/** Enrôle et active la 2FA ; rend le secret et les codes de secours. */
async function enableTotp(
  cookie: string
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const enroll = await t.app.inject({
    method: 'POST',
    url: '/api/auth/totp/enroll',
    headers: { cookie, ...CSRF },
    payload: {},
  });
  expect(enroll.statusCode).toBe(201);
  const { secret } = enroll.json() as { secret: string };
  const activate = await t.app.inject({
    method: 'POST',
    url: '/api/auth/totp/activate',
    headers: { cookie, ...CSRF },
    payload: { code: codeFor(secret) },
  });
  expect(activate.statusCode).toBe(200);
  const { recoveryCodes } = activate.json() as { recoveryCodes: string[] };
  return { secret, recoveryCodes };
}

/** Première étape du login : rend l'en-tête `cookie` du jeton d'étape. */
async function passwordStep(email: TestEmail = 'admin@test'): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: CSRF,
    payload: { email, password: PASSWORDS[email] },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ totpRequired: true });
  // Pas de session : seulement le jeton d'étape, httpOnly et borné à /api/auth.
  expect(res.cookies.find(c => c.name === 'supaboss_session')).toBeUndefined();
  const challenge = res.cookies.find(c => c.name === 'supaboss_mfa');
  expect(challenge).toMatchObject({
    httpOnly: true,
    sameSite: 'Strict',
    path: '/api/auth',
  });
  return `supaboss_mfa=${challenge?.value ?? ''}`;
}

function secondStep(cookie: string, payload: Record<string, string>) {
  return t.app.inject({
    method: 'POST',
    url: '/api/auth/login/totp',
    headers: { cookie, ...CSRF },
    payload,
  });
}

describe('enrôlement', () => {
  it('état initial, puis secret EN ATTENTE, puis actif après un code valide', async () => {
    const cookie = await t.login();
    const status = async () =>
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/auth/totp',
          headers: { cookie },
        })
      ).json() as { totp: Record<string, unknown> };

    expect((await status()).totp).toEqual({
      enabled: false,
      pending: false,
      recoveryCodesLeft: 0,
    });

    const enroll = await t.app.inject({
      method: 'POST',
      url: '/api/auth/totp/enroll',
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(enroll.statusCode).toBe(201);
    const { secret, otpauthUri } = enroll.json() as {
      secret: string;
      otpauthUri: string;
    };
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toContain(`secret=${secret}`);
    expect(otpauthUri).toContain('admin%40test');
    expect((await status()).totp).toMatchObject({
      enabled: false,
      pending: true,
    });

    // Chiffré au repos : le secret n'est pas en clair dans la base.
    const row = t.store.getTotp(
      t.store.findUserByEmail('admin@test')?.id ?? ''
    );
    expect(row?.secretCipher).not.toContain(secret);
    expect(openSecret(row?.secretCipher ?? '', t.masterKey)).toBe(secret);

    // En attente, la 2FA ne s'applique pas encore au login.
    const plain = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF,
      payload: { email: 'admin@test', password: PASSWORDS['admin@test'] },
    });
    expect(plain.json()).toHaveProperty('user');

    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/auth/totp/activate',
      headers: { cookie, ...CSRF },
      payload: { code: codeFor(secret, 5) },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'bad-totp' });

    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/auth/totp/activate',
      headers: { cookie, ...CSRF },
      payload: { code: codeFor(secret) },
    });
    expect(ok.statusCode).toBe(200);
    const { recoveryCodes } = ok.json() as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    expect((await status()).totp).toEqual({
      enabled: true,
      pending: false,
      recoveryCodesLeft: 10,
    });

    // Hachés en base : aucun code de secours en clair.
    const dump = JSON.stringify(
      t.store.db.prepare('SELECT code_hash FROM totp_recovery_codes').all()
    );
    for (const code of recoveryCodes) {
      expect(dump).not.toContain(code.replace('-', ''));
    }
    expect(t.store.listOperations(20).some(o => o.action === 'auth.totp')).toBe(
      true
    );
  });

  it('refus : ré-enrôler un compte protégé, activer sans enrôlement', async () => {
    const cookie = await t.login();
    const orphan = await t.app.inject({
      method: 'POST',
      url: '/api/auth/totp/activate',
      headers: { cookie, ...CSRF },
      payload: { code: '123456' },
    });
    expect(orphan.statusCode).toBe(409);
    expect(orphan.json()).toMatchObject({ error: 'totp-not-enrolled' });

    await enableTotp(cookie);
    const again = await t.app.inject({
      method: 'POST',
      url: '/api/auth/totp/enroll',
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    const reactivate = await t.app.inject({
      method: 'POST',
      url: '/api/auth/totp/activate',
      headers: { cookie, ...CSRF },
      payload: { code: '123456' },
    });
    expect(reactivate.statusCode).toBe(409);
  });

  it('sans session : 401 ; sans en-tête CSRF : 403', async () => {
    const anon = await t.app.inject({ method: 'GET', url: '/api/auth/totp' });
    expect(anon.statusCode).toBe(401);
    const cookie = await t.login();
    const noCsrf = await t.app.inject({
      method: 'POST',
      url: '/api/auth/totp/enroll',
      headers: { cookie },
      payload: {},
    });
    expect(noCsrf.statusCode).toBe(403);
  });
});

describe('connexion en deux temps', () => {
  it('mot de passe → étape → code valide → session', async () => {
    const { secret } = await enableTotp(await t.login());
    const challenge = await passwordStep();

    // Le jeton d'étape n'ouvre RIEN par lui-même.
    const probe = await t.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: challenge },
    });
    expect(probe.statusCode).toBe(401);

    const res = await secondStep(challenge, { code: codeFor(secret, 1) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { email: 'admin@test' } });
    const session = res.cookies.find(c => c.name === 'supaboss_session');
    expect(session).toBeDefined();
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `supaboss_session=${session?.value ?? ''}` },
    });
    expect(me.statusCode).toBe(200);

    // L'étape est consommée : elle ne resservira pas.
    const reuse = await secondStep(challenge, { code: codeFor(secret, 1) });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toMatchObject({ error: 'totp-expired' });
  });

  it('REJEU : le code qui a servi à l’activation est refusé au login', async () => {
    const { secret } = await enableTotp(await t.login());
    const replay = await secondStep(await passwordStep(), {
      code: codeFor(secret),
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toMatchObject({ error: 'bad-totp' });
  });

  it('REJEU : un code accepté au login est refusé à la connexion suivante', async () => {
    const { secret } = await enableTotp(await t.login());
    const code = codeFor(secret, 1);
    expect((await secondStep(await passwordStep(), { code })).statusCode).toBe(
      200
    );
    const replay = await secondStep(await passwordStep(), { code });
    expect(replay.statusCode).toBe(401);
    const failed = t.store
      .listOperations(20)
      .find(o => o.action === 'login' && o.status === 'error');
    expect(failed?.detail).toMatch(/refusé/);
  });

  it('code de secours : une seule fois chacun, le compte baisse', async () => {
    const cookie = await t.login();
    const { recoveryCodes } = await enableTotp(cookie);
    const [first = ''] = recoveryCodes;

    // Saisie « humaine » : minuscules, sans tiret.
    const ok = await secondStep(await passwordStep(), {
      recoveryCode: first.toLowerCase().replace('-', ''),
    });
    expect(ok.statusCode).toBe(200);
    const again = await secondStep(await passwordStep(), {
      recoveryCode: first,
    });
    expect(again.statusCode).toBe(401);

    const status = await t.app.inject({
      method: 'GET',
      url: '/api/auth/totp',
      headers: { cookie },
    });
    expect(status.json()).toMatchObject({ totp: { recoveryCodesLeft: 9 } });
    const logged = t.store
      .listOperations(20)
      .find(o => o.action === 'login' && o.status === 'ok' && o.detail);
    expect(logged?.detail).toMatch(/Code de secours \(9 restant/);
  });

  it('cinq échecs brûlent l’étape : même le bon code ne passe plus', async () => {
    const { secret } = await enableTotp(await t.login());
    const challenge = await passwordStep();
    for (let i = 0; i < 5; i += 1) {
      const res = await secondStep(challenge, { code: '000000' });
      expect(res.statusCode).toBe(401);
    }
    const late = await secondStep(challenge, { code: codeFor(secret, 1) });
    expect(late.statusCode).toBe(401);
    expect(late.json()).toMatchObject({ error: 'totp-expired' });
  });

  it('étape expirée, absente, ou dont la 2FA a disparu : retour au mot de passe', async () => {
    const { secret } = await enableTotp(await t.login());
    const challenge = await passwordStep();
    t.store.db
      .prepare('UPDATE login_challenges SET expires_at=?')
      .run(new Date(Date.now() - 1000).toISOString());
    const expired = await secondStep(challenge, { code: codeFor(secret, 1) });
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toMatchObject({ error: 'totp-expired' });

    const missing = await secondStep('', { code: codeFor(secret, 1) });
    expect(missing.statusCode).toBe(401);

    const orphan = await passwordStep();
    t.store.db.prepare('DELETE FROM user_totp').run();
    const gone = await secondStep(orphan, { code: codeFor(secret, 1) });
    expect(gone.statusCode).toBe(401);
    expect(gone.json()).toMatchObject({ error: 'totp-expired' });
  });

  it('corps invalide (ni code ni code de secours) : 400', async () => {
    await enableTotp(await t.login());
    const res = await secondStep(await passwordStep(), { code: '12ab56' });
    expect(res.statusCode).toBe(400);
  });

  it('limitation de débit : au-delà de 10 essais par minute, 429', async () => {
    await enableTotp(await t.login());
    const challenge = await passwordStep();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push(
        (await secondStep(challenge, { code: '000000' })).statusCode
      );
    }
    expect(statuses.slice(0, 10).every(s => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('un compte SANS 2FA se connecte toujours en une étape', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF,
      payload: { email: 'viewer@test', password: PASSWORDS['viewer@test'] },
    });
    expect(res.json()).toMatchObject({ user: { role: 'viewer' } });
    expect(res.cookies.some(c => c.name === 'supaboss_session')).toBe(true);
  });
});

describe('désactivation', () => {
  async function disable(cookie: string, password: string, code: string) {
    return t.app.inject({
      method: 'POST',
      url: '/api/auth/totp/disable',
      headers: { cookie, ...CSRF },
      payload: { password, code },
    });
  }

  it('exige le mot de passe ET un code', async () => {
    const cookie = await t.login();
    const { secret } = await enableTotp(cookie);

    const badPassword = await disable(cookie, 'pas-le-bon', codeFor(secret, 1));
    expect(badPassword.statusCode).toBe(400);
    expect(badPassword.json()).toMatchObject({ error: 'bad-password' });

    const badCode = await disable(cookie, PASSWORDS['admin@test'], '000000');
    expect(badCode.statusCode).toBe(400);
    expect(badCode.json()).toMatchObject({ error: 'bad-totp' });

    const ok = await disable(
      cookie,
      PASSWORDS['admin@test'],
      codeFor(secret, 1)
    );
    expect(ok.statusCode).toBe(200);
    expect(
      t.store.getTotp(t.store.findUserByEmail('admin@test')?.id ?? '')
    ).toBeNull();
    expect(
      t.store.db.prepare('SELECT COUNT(*) AS n FROM totp_recovery_codes').get()
    ).toEqual({ n: 0 });

    // Plus de seconde étape au login.
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF,
      payload: { email: 'admin@test', password: PASSWORDS['admin@test'] },
    });
    expect(login.json()).toHaveProperty('user');

    const twice = await disable(cookie, PASSWORDS['admin@test'], '123456');
    expect(twice.statusCode).toBe(409);
  });

  it('un code de secours suffit (téléphone perdu)', async () => {
    const cookie = await t.login();
    const { recoveryCodes } = await enableTotp(cookie);
    const res = await disable(
      cookie,
      PASSWORDS['admin@test'],
      recoveryCodes[3] ?? ''
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('secours au démarrage (SUPABOSS_TOTP_RESET)', () => {
  it('retire la 2FA de l’e-mail désigné, et le consigne', async () => {
    await enableTotp(await t.login());
    const report = prepareServer({
      ...t.ctx,
      env: { ...TEST_ENV, totpReset: 'admin@test' },
    });
    expect(report.totpReset).toBe('admin@test');
    expect(report.pushReady).toBe(true);
    expect(
      t.store.getTotp(t.store.findUserByEmail('admin@test')?.id ?? '')
    ).toBeNull();
    expect(
      t.store
        .listOperations(10)
        .some(
          o =>
            o.action === 'auth.totp' &&
            /SUPABOSS_TOTP_RESET/.test(o.detail ?? '')
        )
    ).toBe(true);

    // Rien à retirer : sans effet.
    expect(
      prepareServer({ ...t.ctx, env: { ...TEST_ENV, totpReset: 'admin@test' } })
        .totpReset
    ).toBeNull();
  });
});
