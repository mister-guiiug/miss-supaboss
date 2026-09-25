// @vitest-environment node
/**
 * L'en-tête anti-CSRF sur TOUTES les mutations. Quatre routes historiques ne
 * l'exigeaient pas — connexion, déconnexion, gestion des utilisateurs,
 * réglages — et ne tenaient qu'au cookie `SameSite=Strict`. Le front l'envoie
 * sur chaque requête non-GET (`src/api/http.ts`) : l'exiger ne casse rien, et
 * ferme notamment le « login CSRF » (connecter la victime à un compte choisi
 * par l'attaquant depuis un formulaire d'un autre site).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/contracts.ts';
import {
  CSRF,
  PASSWORDS,
  startTestServer,
  type TestServer,
} from './helpers.ts';

let t: TestServer;
let cookie: string;

beforeEach(async () => {
  t = await startTestServer();
  cookie = await t.login();
});

afterEach(async () => {
  await t.close();
});

describe('routes durcies : sans l’en-tête, 403 csrf ; avec, la route répond', () => {
  const REFUS = {
    error: 'csrf',
    message: 'En-tête X-Supaboss-Csrf manquant',
  };

  it('POST /api/auth/login', async () => {
    const payload = {
      email: 'viewer@test',
      password: PASSWORDS['viewer@test'],
    };
    const bare = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload,
    });
    expect(bare.statusCode).toBe(403);
    expect(bare.json()).toEqual(REFUS);
    // Refusée AVANT tout contrôle : ni session, ni trace de tentative.
    expect(bare.cookies.some(c => c.name === 'supaboss_session')).toBe(false);

    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF,
      payload,
    });
    expect(ok.statusCode).toBe(200);
  });

  it('PUT /api/me/settings', async () => {
    const payload = { ...DEFAULT_SETTINGS, pollingSeconds: 30 };
    const bare = await t.app.inject({
      method: 'PUT',
      url: '/api/me/settings',
      headers: { cookie },
      payload,
    });
    expect(bare.statusCode).toBe(403);
    expect(bare.json()).toEqual(REFUS);
    const unchanged = await t.app.inject({
      method: 'GET',
      url: '/api/me/settings',
      headers: { cookie },
    });
    expect(unchanged.json()).toMatchObject({
      settings: { pollingSeconds: DEFAULT_SETTINGS.pollingSeconds },
    });

    const ok = await t.app.inject({
      method: 'PUT',
      url: '/api/me/settings',
      headers: { cookie, ...CSRF },
      payload,
    });
    expect(ok.statusCode).toBe(200);
  });

  it('POST puis DELETE /api/auth/users', async () => {
    const payload = {
      email: 'nouveau@test',
      password: 'un-mot-de-passe-long',
      role: 'viewer',
    };
    const bareCreate = await t.app.inject({
      method: 'POST',
      url: '/api/auth/users',
      headers: { cookie },
      payload,
    });
    expect(bareCreate.statusCode).toBe(403);
    expect(bareCreate.json()).toEqual(REFUS);
    expect(t.store.findUserByEmail('nouveau@test')).toBeNull();

    const created = await t.app.inject({
      method: 'POST',
      url: '/api/auth/users',
      headers: { cookie, ...CSRF },
      payload,
    });
    expect(created.statusCode).toBe(201);
    const { user } = created.json() as { user: { id: string } };

    const bareDelete = await t.app.inject({
      method: 'DELETE',
      url: `/api/auth/users/${user.id}`,
      headers: { cookie },
    });
    expect(bareDelete.statusCode).toBe(403);
    expect(t.store.findUserByEmail('nouveau@test')).not.toBeNull();

    const deleted = await t.app.inject({
      method: 'DELETE',
      url: `/api/auth/users/${user.id}`,
      headers: { cookie, ...CSRF },
    });
    expect(deleted.statusCode).toBe(200);
  });

  it('POST /api/auth/logout', async () => {
    const bare = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(bare.statusCode).toBe(403);
    // La session tient toujours.
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);

    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, ...CSRF },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('sans session, l’authentification répond d’abord (401), pas la CSRF', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/me/settings',
      payload: DEFAULT_SETTINGS,
    });
    expect(res.statusCode).toBe(401);
  });
});
