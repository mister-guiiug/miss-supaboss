// @vitest-environment node
/**
 * Garde anti-SSRF : le serveur ne doit appeler NI son réseau interne NI les
 * métadonnées du cloud pour le compte d'un utilisateur, quel que soit le
 * déguisement de l'adresse (littérale, décimale, mappée en IPv6, cachée
 * derrière un nom, ou changée entre deux sauts). DNS et réseau factices : pas
 * une question ne part vers un vrai résolveur, pas une requête ne sort.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkDestination,
  isInternalAddress,
} from '../src/notify/destination.ts';
import { postWebhook } from '../src/notify/webhook.ts';
import {
  CSRF,
  FakeNetwork,
  FakeResolver,
  fakeBrowser,
  PUBLIC_TEST_IP,
  startTestServer,
  type TestServer,
} from './helpers.ts';

describe('isInternalAddress — chaque plage', () => {
  it.each([
    ['127.0.0.1', 'boucle locale'],
    ['127.255.255.254', 'boucle locale (fin de 127/8)'],
    ['::1', 'boucle locale IPv6'],
    ['0.0.0.0', 'non spécifiée'],
    ['::', 'non spécifiée IPv6'],
    ['10.0.0.5', 'privée 10/8'],
    ['172.16.0.1', 'privée 172.16/12 (début)'],
    ['172.31.255.254', 'privée 172.16/12 (fin)'],
    ['192.168.1.10', 'privée 192.168/16'],
    ['100.64.0.1', 'CGNAT (début)'],
    ['100.127.255.254', 'CGNAT (fin)'],
    ['169.254.169.254', 'lien local — métadonnées du cloud'],
    ['fe80::1', 'lien local IPv6'],
    ['fe80::1%eth0', 'lien local IPv6 avec zone'],
    ['fc00::1', 'IPv6 unique locale (fc00::/7)'],
    ['fd12:3456:789a::1', 'IPv6 unique locale (fd)'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast (SSDP)'],
    ['ff02::1', 'multicast IPv6'],
    ['240.0.0.1', 'réservée'],
    ['255.255.255.255', 'diffusion'],
    ['192.0.2.1', 'documentation'],
    ['198.18.0.1', 'bancs d’essai'],
    ['2001:db8::1', 'documentation IPv6'],
    ['::ffff:127.0.0.1', 'IPv4 mappée → boucle locale'],
    ['::ffff:7f00:1', 'IPv4 mappée, forme hexadécimale'],
    ['::ffff:10.0.0.5', 'IPv4 mappée → privée'],
    ['::ffff:169.254.169.254', 'IPv4 mappée → métadonnées'],
    ['[::ffff:192.168.0.1]', 'IPv4 mappée entre crochets'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 → 169.254.169.254'],
    ['2002:7f00:1::', '6to4 → 127.0.0.1'],
    ['::127.0.0.1', 'IPv4 « compatible » (obsolète)'],
    ['pas-une-ip', 'illisible : refusée par prudence'],
  ])('%s est interne (%s)', address => {
    expect(isInternalAddress(address)).toBe(true);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['93.184.216.34'],
    ['172.32.0.1'], // juste après 172.16/12
    ['100.128.0.1'], // juste après le CGNAT
    ['2606:4700:4700::1111'],
    ['2001:4860:4860::8888'],
    ['::ffff:8.8.8.8'], // mappée, mais vers une IPv4 publique
    ['64:ff9b::808:808'], // NAT64 vers une IPv4 publique
  ])('%s est publique', address => {
    expect(isInternalAddress(address)).toBe(false);
  });
});

describe('checkDestination — IP littérales et noms', () => {
  const dns = new FakeResolver();

  beforeEach(() => {
    dns.records.clear();
    dns.asked.length = 0;
  });

  it.each([
    ['https://127.0.0.1/'],
    ['https://127.1/'], // forme abrégée
    ['https://2130706433/'], // forme décimale
    ['https://0x7f.0.0.1/'], // forme hexadécimale
    ['https://0177.0.0.1/'], // forme octale
    ['https://[::1]:8443/'],
    ['https://[::ffff:127.0.0.1]/'],
    ['https://169.254.169.254/latest/meta-data/'],
    ['https://10.0.0.5/'],
    ['https://[fd00::2]/'],
  ])('%s : interne, sans aucune résolution', async url => {
    expect(
      await checkDestination(new URL(url), { resolver: dns.resolve })
    ).toBe('internal');
    expect(dns.asked).toEqual([]);
  });

  it('un nom qui résout vers le réseau privé est interne', async () => {
    dns.records.set('evil.example.test', ['10.0.0.5']);
    expect(
      await checkDestination(new URL('https://evil.example.test/hook'), {
        resolver: dns.resolve,
      })
    ).toBe('internal');
    expect(dns.asked).toEqual(['evil.example.test']);
  });

  it('UNE adresse interne parmi plusieurs suffit à refuser', async () => {
    dns.records.set('mixte.example.test', [PUBLIC_TEST_IP, '::1']);
    expect(
      await checkDestination(new URL('https://mixte.example.test/'), {
        resolver: dns.resolve,
      })
    ).toBe('internal');
  });

  it('un nom qui résout vers une IPv4 interne mappée en IPv6 est interne', async () => {
    dns.records.set('mappe.example.test', ['::ffff:192.168.0.1']);
    expect(
      await checkDestination(new URL('https://mappe.example.test/'), {
        resolver: dns.resolve,
      })
    ).toBe('internal');
  });

  it('localhost : boucle locale', async () => {
    expect(
      await checkDestination(new URL('https://localhost:8080/'), {
        resolver: dns.resolve,
      })
    ).toBe('internal');
  });

  it('adresse publique acceptée, littérale ou par un nom', async () => {
    expect(
      await checkDestination(new URL('https://8.8.8.8/'), {
        resolver: dns.resolve,
      })
    ).toBe('ok');
    dns.records.set('public.example.test', [
      PUBLIC_TEST_IP,
      '2606:4700:4700::1111',
    ]);
    expect(
      await checkDestination(new URL('https://public.example.test/'), {
        resolver: dns.resolve,
      })
    ).toBe('ok');
  });

  it('nom inconnu : non résolu, ce qui n’est pas un refus', async () => {
    expect(
      await checkDestination(new URL('https://inconnu.invalid/'), {
        resolver: dns.resolve,
      })
    ).toBe('unresolved');
    const empty = async () => [];
    expect(
      await checkDestination(new URL('https://vide.example.test/'), {
        resolver: empty,
      })
    ).toBe('unresolved');
  });

  it('allowPrivate lève la garde, sans même résoudre', async () => {
    expect(
      await checkDestination(new URL('https://10.0.0.5/'), {
        resolver: dns.resolve,
        allowPrivate: true,
      })
    ).toBe('ok');
    expect(dns.asked).toEqual([]);
  });
});

describe('postWebhook — rien ne part vers l’interne', () => {
  const net = new FakeNetwork();
  const dns = new FakeResolver();

  beforeEach(() => {
    net.sent.length = 0;
    dns.records.clear();
    net.respond = () => new Response('ok', { status: 200 });
  });

  it.each([
    ['https://127.0.0.1:8080/'],
    ['https://[::1]/'],
    ['https://169.254.169.254/latest/meta-data/'],
    ['https://10.0.0.5/'],
    ['https://[::ffff:192.168.1.1]/'],
    ['https://2130706433/'],
  ])('%s : refusé, et aucune requête', async url => {
    const result = await postWebhook(
      url,
      {},
      { fetchImpl: net.fetch, resolver: dns.resolve }
    );
    expect(result).toEqual({
      ok: false,
      status: null,
      error: 'destinataire interne refusé',
    });
    expect(net.sent).toHaveLength(0);
  });

  it('un nom qui résout vers le privé : refusé, aucune requête', async () => {
    dns.records.set('evil.example.test', ['172.20.0.3']);
    const result = await postWebhook(
      'https://evil.example.test/hook',
      {},
      { fetchImpl: net.fetch, resolver: dns.resolve }
    );
    expect(result.error).toBe('destinataire interne refusé');
    expect(net.sent).toHaveLength(0);
  });

  it('adresse publique : envoyé', async () => {
    const result = await postWebhook(
      'https://hooks.example.test/x',
      { x: 1 },
      { fetchImpl: net.fetch, resolver: dns.resolve }
    );
    expect(result).toEqual({ ok: true, status: 200, error: null });
    expect(net.sent).toHaveLength(1);
  });

  it('REBINDING entre deux sauts : la redirection dans la même origine est refusée', async () => {
    // Le même nom résout publiquement au premier saut, puis vers les
    // métadonnées du cloud au second : c'est pourquoi la garde passe AVANT
    // CHAQUE saut, et pas une fois pour toutes.
    let calls = 0;
    const flipping = async () => {
      calls += 1;
      return [
        {
          address: calls === 1 ? PUBLIC_TEST_IP : '169.254.169.254',
          family: 4,
        },
      ];
    };
    net.respond = () =>
      new Response(null, { status: 307, headers: { location: '/suite' } });
    const result = await postWebhook(
      'https://rebind.example.test/debut',
      {},
      { fetchImpl: net.fetch, resolver: flipping }
    );
    expect(calls).toBe(2);
    expect(result.error).toBe('destinataire interne refusé');
    expect(net.sent.map(r => r.url)).toEqual([
      'https://rebind.example.test/debut',
    ]);
  });

  it('nom qui ne résout pas : injoignable, sans requête', async () => {
    const result = await postWebhook(
      'https://inconnu.invalid/',
      {},
      { fetchImpl: net.fetch, resolver: dns.resolve }
    );
    expect(result.error).toBe('destinataire injoignable');
    expect(net.sent).toHaveLength(0);
  });

  it('allowPrivate : le réseau local redevient joignable', async () => {
    const result = await postWebhook(
      'https://192.168.1.20/ntfy',
      {},
      { fetchImpl: net.fetch, resolver: dns.resolve, allowPrivate: true }
    );
    expect(result.ok).toBe(true);
    expect(net.sent.map(r => r.url)).toEqual(['https://192.168.1.20/ntfy']);
  });
});

describe('routes — refus à l’enregistrement et à l’envoi', () => {
  let t: TestServer;
  let cookie: string;

  afterEach(async () => {
    await t.close();
  });

  async function putWebhook(url: string | null) {
    return t.app.inject({
      method: 'PUT',
      url: '/api/notifications/webhook',
      headers: { cookie, ...CSRF },
      payload: { url },
    });
  }

  describe('garde active (défaut)', () => {
    beforeEach(async () => {
      t = await startTestServer();
      // Un simple lecteur : c'est lui, l'attaquant du scénario.
      cookie = await t.login('viewer@test');
    });

    it.each([
      ['https://169.254.169.254/latest/meta-data/'],
      ['https://127.0.0.1:2375/containers/json'],
      ['https://[::ffff:10.0.0.5]/'],
    ])('webhook %s : 400, rien enregistré', async url => {
      const res = await putWebhook(url);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'internal-destination',
        message: expect.stringMatching(
          /^Destinataire interne refusé.*SUPABOSS_WEBHOOK_ALLOW_PRIVATE=1/
        ) as string,
      });
      const settings = await t.app.inject({
        method: 'GET',
        url: '/api/notifications/settings',
        headers: { cookie },
      });
      expect(settings.json()).toMatchObject({
        settings: { webhook: { configured: false } },
      });
    });

    it('webhook dont le NOM résout vers le privé : 400', async () => {
      t.dns.records.set('ntfy.maison.test', ['192.168.1.20']);
      const res = await putWebhook('https://ntfy.maison.test/alertes');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'internal-destination' });
      expect(t.dns.asked).toContain('ntfy.maison.test');
    });

    it('webhook public : accepté ; un nom qui ne résout pas encore aussi', async () => {
      expect(
        (await putWebhook('https://hooks.example.test/services/x')).statusCode
      ).toBe(200);
      expect(
        (await putWebhook('https://pas-encore.invalid/hook')).statusCode
      ).toBe(200);
    });

    it('abonnement push dont l’endpoint vise l’interne : 400', async () => {
      const { subscription } = fakeBrowser('https://10.0.0.8/push');
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/notifications/push-subscriptions',
        headers: { cookie, ...CSRF },
        payload: { subscription },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'internal-destination',
        message:
          'Destinataire interne refusé : un service push est toujours public.',
      });
    });

    it('le DNS change APRÈS l’enregistrement : l’envoi de test est refusé et le dit', async () => {
      t.dns.records.set('bascule.example.test', [PUBLIC_TEST_IP]);
      expect(
        (await putWebhook('https://bascule.example.test/hook')).statusCode
      ).toBe(200);
      t.dns.records.set('bascule.example.test', ['169.254.169.254']);

      const res = await t.app.inject({
        method: 'POST',
        url: '/api/notifications/test',
        headers: { cookie, ...CSRF },
        payload: {},
      });
      expect(res.json()).toMatchObject({
        report: {
          webhook: 'failed',
          detail: 'webhook : destinataire interne refusé',
        },
      });
      expect(t.net.sent).toHaveLength(0);
    });
  });

  describe('SUPABOSS_WEBHOOK_ALLOW_PRIVATE=1', () => {
    beforeEach(async () => {
      t = await startTestServer({ env: { webhookAllowPrivate: true } });
      cookie = await t.login('viewer@test');
    });

    it('un ntfy du réseau local s’enregistre et reçoit le test', async () => {
      t.dns.records.set('ntfy.maison.test', ['192.168.1.20']);
      expect(
        (await putWebhook('https://ntfy.maison.test/alertes')).statusCode
      ).toBe(200);
      t.net.respond = () => new Response('ok', { status: 200 });
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/notifications/test',
        headers: { cookie, ...CSRF },
        payload: {},
      });
      expect(res.json()).toMatchObject({ report: { webhook: 'sent' } });
      expect(t.net.sent.map(r => r.url)).toEqual([
        'https://ntfy.maison.test/alertes',
      ]);
    });

    it('la levée ne vaut PAS pour le push : un service push est toujours public', async () => {
      const { subscription } = fakeBrowser('https://10.0.0.8/push');
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/notifications/push-subscriptions',
        headers: { cookie, ...CSRF },
        payload: { subscription },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
