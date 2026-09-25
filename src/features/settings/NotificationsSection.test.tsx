import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.ts';
import { NotificationsSection } from './NotificationsSection.tsx';

// LA CI DE LA FAMILLE INJECTE `VITE_MOCK=1` AVANT LES TESTS (c'est le build
// de la démo Pages). `IS_MOCK` se calcule au chargement du module : sans ce
// mock, l'app parle au mock intégral et jamais au `fetch` que ce fichier
// intercepte. Vert en local, rouge en CI : c'est arrivé le 25/09/2026.
vi.mock('../../api/demoMode.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/demoMode.ts')>()),
  FORCED_MOCK: false,
  REAL_AVAILABLE: true,
  IS_MOCK: false,
}));

/**
 * Mode serveur : client HTTP réel et VRAI client push du socle
 * (`createPushClient` + `httpPushTransport`), sur un navigateur simulé —
 * service worker, `PushManager`, permission. Seuls `fetch` et ces API du
 * navigateur sont des doublures.
 */
interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

let calls: Call[];
let server: {
  subscriptions: number;
  webhookHint: string | null;
  report: unknown;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** 87 caractères base64url : la forme d'une clé VAPID publique (65 octets). */
const PUBLIC_KEY = 'B'.repeat(87);

function settingsBody() {
  return {
    settings: {
      push: {
        available: true,
        publicKey: PUBLIC_KEY,
        subscriptions: server.subscriptions,
      },
      webhook: {
        configured: server.webhookHint !== null,
        hint: server.webhookHint,
      },
      lastDelivery: null,
    },
  };
}

/** Un navigateur qui sait le push : worker prêt, permission accordée. */
function fakePushBrowser() {
  let current: unknown = null;
  const subscription = {
    endpoint: 'https://push.example.test/abo',
    expirationTime: null,
    getKey: (name: string) =>
      new Uint8Array(name === 'p256dh' ? [4, 1, 2] : [9, 9]).buffer,
    unsubscribe: vi.fn(async () => {
      current = null;
      return true;
    }),
  };
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = subscription;
      return subscription;
    }),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', {
    permission: 'default',
    requestPermission: vi.fn(async () => 'granted'),
  });
  return { pushManager, subscription };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('supaboss_locale', 'fr');
  calls = [];
  server = {
    subscriptions: 0,
    webhookHint: null,
    report: {
      push: { sent: 1, failed: 0, removed: 0 },
      webhook: 'sent',
      detail: 'push : 1 appareil atteint ; webhook : HTTP 200',
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body
        ? (JSON.parse(String(init.body)) as unknown)
        : null;
      calls.push({
        url,
        method,
        body,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      if (url === '/api/notifications/settings')
        return json(200, settingsBody());
      if (url === '/api/notifications/push-subscriptions') {
        server.subscriptions += method === 'POST' ? 1 : -1;
        return json(method === 'POST' ? 201 : 200, settingsBody());
      }
      if (url === '/api/notifications/webhook') {
        const { url: hook } = body as { url: string | null };
        server.webhookHint =
          hook === null ? null : 'https://hooks.example.test/…abcd';
        return json(200, settingsBody());
      }
      if (url === '/api/notifications/test') {
        return json(200, { report: server.report });
      }
      return json(404, { error: 'not-found', message: url });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

function renderSection() {
  render(
    <I18nProvider>
      <NotificationsSection />
    </I18nProvider>
  );
  return userEvent.setup();
}

describe('NotificationsSection — serveur', () => {
  it('sans service worker : le push est dit indisponible, le reste marche', async () => {
    renderSection();
    expect(
      await screen.findByText(
        'Ce navigateur ne sait pas recevoir de notifications push.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Pas d’e-mail : il faudrait un serveur SMTP.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Démo :/)).not.toBeInTheDocument();
  });

  it('abonne CE navigateur par le transport HTTP du socle, puis le désabonne', async () => {
    const { pushManager } = fakePushBrowser();
    const user = renderSection();
    await user.click(
      await screen.findByRole('button', { name: 'Activer sur cet appareil' })
    );
    await waitFor(() =>
      expect(screen.getByText('Activé sur cet appareil.')).toBeInTheDocument()
    );
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true })
    );
    const save = calls.find(
      c =>
        c.url === '/api/notifications/push-subscriptions' && c.method === 'POST'
    );
    expect(save?.headers['x-supaboss-csrf']).toBe('1');
    expect(save?.body).toMatchObject({
      subscription: {
        endpoint: 'https://push.example.test/abo',
        keys: { p256dh: 'BAEC', auth: 'CQk' },
      },
    });
    expect(
      screen.getByText('1 appareil(s) abonné(s) au total.')
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Désactiver sur cet appareil' })
    );
    await waitFor(() =>
      expect(
        screen.getByText('Désactivé sur cet appareil.')
      ).toBeInTheDocument()
    );
    expect(
      calls.some(
        c =>
          c.url === '/api/notifications/push-subscriptions' &&
          c.method === 'DELETE'
      )
    ).toBe(true);
  });

  it('permission refusée : dit où la rétablir', async () => {
    fakePushBrowser();
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn(async () => 'denied'),
    });
    const user = renderSection();
    await user.click(
      await screen.findByRole('button', { name: 'Activer sur cet appareil' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Notifications refusées dans ce navigateur'
    );
  });

  it('webhook : https exigé localement, puis enregistré en abrégé', async () => {
    const user = renderSection();
    const field = await screen.findByLabelText('URL https du webhook');
    await user.type(field, 'http://hooks.example.test/x');
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer le webhook' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'URL https:// attendue'
    );
    expect(calls.some(c => c.url === '/api/notifications/webhook')).toBe(false);

    await user.clear(field);
    await user.type(field, 'https://hooks.example.test/services/secret-abcd');
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer le webhook' })
    );
    expect(
      await screen.findByText(
        'Webhook enregistré : https://hooks.example.test/…abcd'
      )
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Retirer le webhook' })
    );
    expect(await screen.findByText('Aucun webhook.')).toBeInTheDocument();
  });

  it('notification de test : le statut de livraison est annoncé', async () => {
    const user = renderSection();
    await user.click(
      await screen.findByRole('button', {
        name: 'Envoyer une notification de test',
      })
    );
    expect(
      await screen.findByText(
        'Test envoyé — push : 1 appareil atteint ; webhook : HTTP 200'
      )
    ).toBeInTheDocument();

    server.report = {
      push: { sent: 0, failed: 0, removed: 1 },
      webhook: 'skipped',
      detail: 'push : 0 appareil atteint, 1 abonnement expiré retiré',
    };
    await user.click(
      screen.getByRole('button', { name: 'Envoyer une notification de test' })
    );
    expect(
      await screen.findByText(/^Test en échec — push : 0 appareil atteint/)
    ).toBeInTheDocument();
  });
});
