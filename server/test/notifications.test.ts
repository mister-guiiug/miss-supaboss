// @vitest-environment node
/**
 * Notifications : clés VAPID, canaux (Web Push, webhook), envoi de test et
 * statut de livraison. Le réseau est FACTICE (`helpers.ts`) : on vérifie ce
 * qui partirait, jamais on ne l'envoie.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NotificationSettingsDto } from '../../shared/contracts.ts';
import { generateMasterKey } from '../src/crypto.ts';
import { NotificationService } from '../src/notify/service.ts';
import { postWebhook, webhookHint } from '../src/notify/webhook.ts';
import {
  CSRF,
  FakeNetwork,
  FakeResolver,
  fakeBrowser,
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

const HOOK = 'https://hooks.example.test/services/T000/B000/secret-abcd';

async function settings(who = cookie): Promise<NotificationSettingsDto> {
  const res = await t.app.inject({
    method: 'GET',
    url: '/api/notifications/settings',
    headers: { cookie: who },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { settings: NotificationSettingsDto }).settings;
}

async function subscribe(subscription: unknown, who = cookie) {
  return t.app.inject({
    method: 'POST',
    url: '/api/notifications/push-subscriptions',
    headers: { cookie: who, ...CSRF },
    payload: { subscription },
  });
}

async function setWebhook(url: string | null) {
  return t.app.inject({
    method: 'PUT',
    url: '/api/notifications/webhook',
    headers: { cookie, ...CSRF },
    payload: { url },
  });
}

async function sendTest() {
  return t.app.inject({
    method: 'POST',
    url: '/api/notifications/test',
    headers: { cookie, ...CSRF },
    payload: {},
  });
}

describe('clés VAPID', () => {
  it('engendrées une fois, exposées publiques, scellées au repos', async () => {
    const s = await settings();
    expect(s.push.available).toBe(true);
    expect(s.push.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(JSON.stringify(s)).not.toMatch(/privateKey|"d"/);

    const sealed = t.store.getMeta('vapid_keys') ?? '';
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain(s.push.publicKey);

    // Même base, même clé maître : mêmes clés (les abonnés restent valides).
    const again = new NotificationService(t.store, t.masterKey, {
      subject: 'mailto:a@b.test',
    });
    expect(again.vapidKeys()?.publicKey).toBe(s.push.publicKey);
  });

  it('clé maître changée : push indisponible, clés PAS remplacées', async () => {
    const before = (await settings()).push.publicKey as string;
    const sealed = t.store.getMeta('vapid_keys');
    const lost = new NotificationService(t.store, generateMasterKey(), {
      subject: 'mailto:a@b.test',
    });
    expect(lost.vapidKeys()).toBeNull();
    expect(t.store.getMeta('vapid_keys')).toBe(sealed);

    const browser = fakeBrowser();
    await subscribe(browser.subscription);
    const user = t.store.findUserByEmail('admin@test');
    if (!user) throw new Error('admin absent');
    expect(lost.settingsFor(user).push.available).toBe(false);
    const report = await lost.deliver(user, {
      event: 'test',
      title: 'x',
      body: 'y',
      path: '#/',
      tag: 't',
    });
    expect(report.push).toEqual({ sent: 0, failed: 1, removed: 0 });
    expect(report.detail).toMatch(/clés VAPID illisibles/);
    expect(before).toBeTruthy();
  });
});

describe('abonnements Web Push', () => {
  it('abonnement puis désabonnement de CE navigateur', async () => {
    const browser = fakeBrowser();
    const res = await subscribe(browser.subscription);
    expect(res.statusCode).toBe(201);
    expect((await settings()).push.subscriptions).toBe(1);

    // Réabonner le même navigateur ne le compte pas deux fois.
    await subscribe(browser.subscription);
    expect((await settings()).push.subscriptions).toBe(1);

    const del = await t.app.inject({
      method: 'DELETE',
      url: '/api/notifications/push-subscriptions',
      headers: { cookie, ...CSRF },
      payload: { subscription: { endpoint: browser.subscription.endpoint } },
    });
    expect(del.statusCode).toBe(200);
    expect((await settings()).push.subscriptions).toBe(0);
  });

  it('un poste partagé passe à celui qui s’abonne en dernier', async () => {
    const browser = fakeBrowser();
    await subscribe(browser.subscription);
    const viewer = await t.login('viewer@test');
    expect((await subscribe(browser.subscription, viewer)).statusCode).toBe(
      201
    );
    expect((await settings()).push.subscriptions).toBe(0);
    expect((await settings(viewer)).push.subscriptions).toBe(1);
  });

  it.each([
    ['endpoint http', { endpoint: 'http://push.example.test/x' }],
    [
      'clé p256dh tronquée',
      { keys: { p256dh: 'A'.repeat(86), auth: 'A'.repeat(22) } },
    ],
    ['secret auth absent', { keys: { p256dh: 'A'.repeat(87) } }],
  ])('refus : %s', async (_label, patch) => {
    const { subscription } = fakeBrowser();
    const res = await subscribe({ ...subscription, ...patch });
    expect(res.statusCode).toBe(400);
  });

  it('clés de la bonne longueur mais pas un point P-256 : 400', async () => {
    const { subscription } = fakeBrowser();
    const res = await subscribe({
      ...subscription,
      keys: {
        p256dh: Buffer.alloc(65, 7).toString('base64url'),
        auth: subscription.keys.auth,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation' });
  });

  it('sans session 401, sans CSRF 403', async () => {
    const { subscription } = fakeBrowser();
    const anon = await t.app.inject({
      method: 'POST',
      url: '/api/notifications/push-subscriptions',
      payload: { subscription },
    });
    expect(anon.statusCode).toBe(401);
    const noCsrf = await t.app.inject({
      method: 'POST',
      url: '/api/notifications/push-subscriptions',
      headers: { cookie },
      payload: { subscription },
    });
    expect(noCsrf.statusCode).toBe(403);
  });
});

describe('webhook', () => {
  it('https seulement, sans identifiants', async () => {
    expect((await setWebhook('http://hooks.example.test/x')).statusCode).toBe(
      400
    );
    expect(
      (await setWebhook('https://moi:secret@hooks.example.test/x')).statusCode
    ).toBe(400);
    expect((await setWebhook('pas une url')).statusCode).toBe(400);
  });

  it('enregistré scellé, rendu en indice seulement, puis retiré', async () => {
    const res = await setWebhook(HOOK);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { settings: { webhook: unknown } };
    expect(body.settings.webhook).toEqual({
      configured: true,
      hint: 'https://hooks.example.test/…abcd',
    });
    expect(JSON.stringify(res.json())).not.toContain('secret-abcd');
    const row = t.store.db
      .prepare('SELECT webhook_cipher FROM notification_channels')
      .get() as { webhook_cipher: string };
    expect(row.webhook_cipher).not.toContain('hooks.example.test');

    const cleared = await setWebhook(null);
    expect(
      (cleared.json() as { settings: { webhook: unknown } }).settings.webhook
    ).toEqual({ configured: false, hint: null });
  });
});

describe('notification de test et statut de livraison', () => {
  it('push + webhook : remis, contenu lisible par le seul navigateur, consigné', async () => {
    const browser = fakeBrowser();
    await subscribe(browser.subscription);
    await setWebhook(HOOK);
    t.net.respond = req =>
      new Response(null, { status: req.url === HOOK ? 200 : 201 });

    const res = await sendTest();
    expect(res.statusCode).toBe(200);
    const { report } = res.json() as {
      report: { push: unknown; webhook: string; detail: string };
    };
    expect(report.push).toEqual({ sent: 1, failed: 0, removed: 0 });
    expect(report.webhook).toBe('sent');
    expect(report.detail).toBe(
      'push : 1 appareil atteint ; webhook : HTTP 200'
    );

    const push = t.net.sent.find(r => r.url === browser.subscription.endpoint);
    const headers = push?.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^vapid t=.+, k=/);
    const message = JSON.parse(browser.decrypt(push?.init.body as Buffer)) as {
      title: string;
      url: string;
    };
    expect(message.title).toBe('Miss Supaboss — notification de test');
    expect(message.url).toBe('./#/settings');

    const hook = t.net.sent.find(r => r.url === HOOK);
    expect(hook?.init.method).toBe('POST');
    const json = JSON.parse(String(hook?.init.body)) as Record<string, string>;
    expect(json).toMatchObject({
      source: 'miss-supaboss',
      event: 'test',
      title: 'Miss Supaboss — notification de test',
      text: expect.stringContaining('ce canal fonctionne') as string,
      content: expect.stringContaining('ce canal fonctionne') as string,
    });

    const s = await settings();
    expect(s.lastDelivery).toMatchObject({ status: 'ok' });
    expect(
      t.store.listOperations(5).find(o => o.action === 'alert.send')
    ).toMatchObject({ status: 'ok', userEmail: 'admin@test' });
  });

  it('abonnement expiré (410) : retiré, et la remise est un échec', async () => {
    const browser = fakeBrowser();
    await subscribe(browser.subscription);
    t.net.respond = () => new Response('', { status: 410 });
    const { report } = (await sendTest()).json() as {
      report: { push: unknown; detail: string };
    };
    expect(report.push).toEqual({ sent: 0, failed: 0, removed: 1 });
    expect(report.detail).toMatch(/1 abonnement expiré retiré/);
    expect((await settings()).push.subscriptions).toBe(0);
    expect((await settings()).lastDelivery).toMatchObject({ status: 'error' });
  });

  it('panne d’un canal : l’autre part quand même', async () => {
    const ok = fakeBrowser('https://push.example.test/ok');
    const ko = fakeBrowser('https://push.example.test/ko');
    await subscribe(ok.subscription);
    await subscribe(ko.subscription);
    await setWebhook(HOOK);
    t.net.respond = req =>
      new Response(null, {
        status: req.url.endsWith('/ko') ? 500 : req.url === HOOK ? 502 : 201,
      });
    const { report } = (await sendTest()).json() as {
      report: { push: unknown; webhook: string; detail: string };
    };
    expect(report.push).toEqual({ sent: 1, failed: 1, removed: 0 });
    expect(report.webhook).toBe('failed');
    expect(report.detail).toBe(
      'push : 1 appareil atteint, 1 échec ; webhook : HTTP 502'
    );
    const row = t.store
      .listPushSubscriptions(t.store.findUserByEmail('admin@test')?.id ?? '')
      .find(s => s.endpoint.endsWith('/ko'));
    expect(row?.lastError).toBe('HTTP 500');
  });

  it('aucun canal : rien ne part, et c’est dit', async () => {
    const { report } = (await sendTest()).json() as {
      report: { webhook: string; detail: string };
    };
    expect(report.webhook).toBe('skipped');
    expect(report.detail).toBe('aucun canal configuré');
    expect(t.net.sent).toHaveLength(0);
  });

  it('pas de rafale : cinq tests par minute', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) codes.push((await sendTest()).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe('postWebhook — les bornes', () => {
  const net = new FakeNetwork();
  // DNS factice : aucune question ne part vers un vrai résolveur.
  const dns = new FakeResolver();

  beforeEach(() => {
    net.sent.length = 0;
  });

  it('suit une redirection dans la MÊME origine, en renvoyant le corps', async () => {
    net.respond = req =>
      req.url.endsWith('/a')
        ? new Response(null, { status: 307, headers: { location: '/b' } })
        : new Response('ok', { status: 200 });
    const result = await postWebhook(
      'https://hooks.example.test/a',
      { x: 1 },
      {
        fetchImpl: net.fetch,
        resolver: dns.resolve,
      }
    );
    expect(result).toEqual({ ok: true, status: 200, error: null });
    expect(net.sent.map(r => r.url)).toEqual([
      'https://hooks.example.test/a',
      'https://hooks.example.test/b',
    ]);
    expect(net.sent[1]?.init.body).toBe('{"x":1}');
    expect(net.sent[0]?.init.redirect).toBe('manual');
  });

  it.each([
    ['autre hôte', 'https://ailleurs.example.test/b'],
    ['même hôte en http', 'http://hooks.example.test/b'],
  ])(
    'refuse une redirection vers une autre origine (%s)',
    async (_l, location) => {
      net.respond = () =>
        new Response(null, { status: 302, headers: { location } });
      const result = await postWebhook(
        'https://hooks.example.test/a',
        {},
        {
          fetchImpl: net.fetch,
          resolver: dns.resolve,
        }
      );
      expect(result).toMatchObject({
        ok: false,
        error: 'redirection vers une autre origine refusée',
      });
      expect(net.sent).toHaveLength(1);
    }
  );

  it('redirection sans destination, boucle de redirections', async () => {
    net.respond = () => new Response(null, { status: 301 });
    expect(
      (
        await postWebhook(
          'https://h.example.test/a',
          {},
          { fetchImpl: net.fetch, resolver: dns.resolve }
        )
      ).error
    ).toBe('HTTP 301 sans destination');

    net.respond = () =>
      new Response(null, { status: 308, headers: { location: '/a' } });
    const loop = await postWebhook(
      'https://h.example.test/a',
      {},
      {
        fetchImpl: net.fetch,
        resolver: dns.resolve,
        maxRedirects: 2,
      }
    );
    expect(loop.error).toBe('trop de redirections');
  });

  it('délai dépassé, destinataire injoignable, URL refusée', async () => {
    net.respond = () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    };
    expect(
      (
        await postWebhook(
          'https://h.example.test/',
          {},
          { fetchImpl: net.fetch, resolver: dns.resolve }
        )
      ).error
    ).toBe('délai dépassé');
    net.respond = () => {
      throw new TypeError('fetch failed');
    };
    expect(
      (
        await postWebhook(
          'https://h.example.test/',
          {},
          { fetchImpl: net.fetch, resolver: dns.resolve }
        )
      ).error
    ).toBe('destinataire injoignable');
    expect((await postWebhook('http://h.example.test/', {})).error).toBe(
      'https requis'
    );
    expect((await postWebhook('::', {})).error).toBe('URL illisible');
  });

  it('webhookHint : l’origine et la fin, jamais le secret entier', () => {
    expect(webhookHint(HOOK)).toBe('https://hooks.example.test/…abcd');
    expect(webhookHint('https://ntfy.sh/ab')).toBe('https://ntfy.sh/ab');
    expect(webhookHint('::')).toBe('…');
  });
});
