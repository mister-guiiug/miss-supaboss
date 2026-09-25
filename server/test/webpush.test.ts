// @vitest-environment node
/**
 * Web Push maison : on ne peut pas appeler un vrai service push depuis un
 * test, alors on vérifie ce qu'un service push et un navigateur vérifieraient.
 *
 * 1. Le vecteur de l'annexe A de la RFC 8291, octet pour octet.
 * 2. Un aller-retour : un « navigateur » de test (sa propre paire ECDH et son
 *    secret) déchiffre ce qu'on lui envoie, par un code de déchiffrement
 *    écrit dans `helpers.ts`, indépendant de celui du serveur.
 * 3. Le JWT VAPID, vérifié avec la clé publique comme le ferait le service.
 */
import { describe, expect, it } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import {
  encryptPushPayload,
  generateVapidKeys,
  sendWebPush,
  vapidAuthorization,
} from '../src/notify/webpush.ts';
import { FakeResolver, fakeBrowser } from './helpers.ts';

const b64u = (value: string): Buffer => Buffer.from(value, 'base64url');

describe('RFC 8291, annexe A', () => {
  it('rejoue le message d’exemple à l’octet près', () => {
    const body = encryptPushPayload(
      Buffer.from('When I grow up, I want to be a watermelon'),
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      {
        salt: b64u('DGv6ra1nlYgDCS1FRnbzlw'),
        privateKey: b64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
      }
    );
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMo' +
        'ZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf' +
        '1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
    );
  });
});

describe('chiffrement aes128gcm', () => {
  it('le navigateur abonné, et lui seul, relit le message', () => {
    const browser = fakeBrowser();
    const body = encryptPushPayload(
      Buffer.from('{"title":"é"}'),
      browser.target
    );
    expect(browser.decrypt(body)).toBe('{"title":"é"}');
    // Un autre navigateur ne peut pas : l'étiquette GCM ne passe pas.
    expect(() => fakeBrowser().decrypt(body)).toThrow();
  });

  it('clé et sel neufs à chaque message', () => {
    const browser = fakeBrowser();
    const a = encryptPushPayload(Buffer.from('x'), browser.target);
    const b = encryptPushPayload(Buffer.from('x'), browser.target);
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it('refuse un abonnement aux clés tronquées', () => {
    expect(() =>
      encryptPushPayload(Buffer.from('x'), { p256dh: 'AAAA', auth: 'AAAA' })
    ).toThrow(/p256dh/);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('JWT ES256 vérifiable avec la clé publique, audience = origine', () => {
    const keys = generateVapidKeys();
    const header = vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      keys,
      'mailto:admin@example.test',
      Date.parse('2026-09-25T10:00:00Z')
    );
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [jwt, k] = [match?.[1] ?? '', match?.[2] ?? ''];
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(b64u(h ?? '').toString())).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
    const claims = JSON.parse(b64u(c ?? '').toString()) as {
      aud: string;
      exp: number;
      sub: string;
    };
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:admin@example.test');
    // Moins de 24 h (RFC 8292 §2).
    expect(claims.exp - Date.parse('2026-09-25T10:00:00Z') / 1000).toBe(
      12 * 3600
    );

    const pub = b64u(keys.publicKey);
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pub.subarray(1, 33).toString('base64url'),
        y: pub.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${c}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        b64u(s ?? '')
      )
    ).toBe(true);
  });
});

describe('sendWebPush', () => {
  const keys = generateVapidKeys();
  // DNS factice : aucune question ne part vers un vrai résolveur.
  const dns = new FakeResolver();

  it('201 : remis ; le corps envoyé est bien celui que le navigateur relit', async () => {
    const browser = fakeBrowser();
    let seen: { url: string; init: RequestInit } | null = null;
    const result = await sendWebPush(
      browser.target,
      { title: 'Salut' },
      {
        keys,
        subject: 'mailto:a@b.test',
        resolver: dns.resolve,
        fetchImpl: (async (url: string, init: RequestInit) => {
          seen = { url, init };
          return new Response(null, { status: 201 });
        }) as unknown as typeof fetch,
      }
    );
    expect(result).toEqual({ ok: true, status: 201, gone: false, error: null });
    const sent = seen as unknown as { url: string; init: RequestInit };
    expect(sent.url).toBe(browser.target.endpoint);
    const headers = sent.init.headers as Record<string, string>;
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers.authorization).toMatch(/^vapid t=/);
    expect(sent.init.redirect).toBe('error');
    expect(browser.decrypt(sent.init.body as Buffer)).toBe('{"title":"Salut"}');
  });

  it.each([404, 410])('%i : abonnement expiré, à oublier', async status => {
    const result = await sendWebPush(
      fakeBrowser().target,
      {},
      {
        keys,
        subject: 'mailto:a@b.test',
        resolver: dns.resolve,
        fetchImpl: (async () =>
          new Response('', { status })) as unknown as typeof fetch,
      }
    );
    expect(result).toMatchObject({ ok: false, gone: true, status });
  });

  it('500 et panne réseau : échec sans lever', async () => {
    const e500 = await sendWebPush(
      fakeBrowser().target,
      {},
      {
        keys,
        subject: 'mailto:a@b.test',
        resolver: dns.resolve,
        fetchImpl: (async () =>
          new Response('', { status: 500 })) as unknown as typeof fetch,
      }
    );
    expect(e500).toMatchObject({ ok: false, gone: false, error: 'HTTP 500' });
    const down = await sendWebPush(
      fakeBrowser().target,
      {},
      {
        keys,
        subject: 'mailto:a@b.test',
        resolver: dns.resolve,
        fetchImpl: (async () => {
          throw new TypeError('fetch failed');
        }) as unknown as typeof fetch,
      }
    );
    expect(down).toMatchObject({ ok: false, status: null, gone: false });
  });

  it('message trop long : refusé avant tout envoi', async () => {
    let called = false;
    const result = await sendWebPush(
      fakeBrowser().target,
      { body: 'x'.repeat(5000) },
      {
        keys,
        subject: 'mailto:a@b.test',
        resolver: dns.resolve,
        fetchImpl: (async () => {
          called = true;
          return new Response(null, { status: 201 });
        }) as unknown as typeof fetch,
      }
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it.each([
    ['IP littérale de lien local', 'https://169.254.169.254/latest'],
    ['IPv4 mappée vers la boucle locale', 'https://[::ffff:127.0.0.1]/x'],
    ['nom qui résout vers le réseau privé', 'https://interne.example.test/x'],
  ])(
    'SSRF : endpoint forgé (%s) refusé AVANT tout envoi',
    async (_label, endpoint) => {
      dns.records.set('interne.example.test', ['10.1.2.3']);
      let called = false;
      const result = await sendWebPush(
        { ...fakeBrowser().target, endpoint },
        { title: 'x' },
        {
          keys,
          subject: 'mailto:a@b.test',
          resolver: dns.resolve,
          fetchImpl: (async () => {
            called = true;
            return new Response(null, { status: 201 });
          }) as unknown as typeof fetch,
        }
      );
      expect(result).toEqual({
        ok: false,
        status: null,
        gone: false,
        error: 'destinataire interne refusé',
      });
      expect(called).toBe(false);
    }
  );
});
