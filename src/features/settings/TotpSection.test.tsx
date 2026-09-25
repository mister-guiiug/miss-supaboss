import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.ts';
import { TotpSection } from './TotpSection.tsx';

/**
 * Enrôlement de bout en bout côté écran : client HTTP réel, `fetch` simulé,
 * et le VRAI module `qr` du socle (sa peer `uqr` doit se charger — c'est ce
 * que le build de production fera aussi).
 */
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const CODES = Array.from({ length: 10 }, (_, i) => `AAAA${i}-BBBBB`);

let state: { enabled: boolean; pending: boolean; left: number };
let requests: { url: string; body: unknown }[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('supaboss_locale', 'fr');
  state = { enabled: false, pending: false, left: 0 };
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = init.body
        ? (JSON.parse(String(init.body)) as unknown)
        : null;
      requests.push({ url, body });
      switch (url) {
        case '/api/auth/totp':
          return json(200, {
            totp: {
              enabled: state.enabled,
              pending: state.pending,
              recoveryCodesLeft: state.left,
            },
          });
        case '/api/auth/totp/enroll':
          state.pending = true;
          return json(201, {
            secret: SECRET,
            otpauthUri: `otpauth://totp/Miss%20Supaboss:admin%40local?secret=${SECRET}&issuer=Miss%20Supaboss`,
          });
        case '/api/auth/totp/activate':
          if ((body as { code: string }).code !== '123456') {
            return json(400, { error: 'bad-totp', message: 'Code invalide' });
          }
          state = { enabled: true, pending: false, left: 10 };
          return json(200, { recoveryCodes: CODES });
        case '/api/auth/totp/disable':
          state = { enabled: false, pending: false, left: 0 };
          return json(200, { ok: true });
        default:
          return json(404, { error: 'not-found', message: url });
      }
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSection() {
  render(
    <I18nProvider>
      <TotpSection />
    </I18nProvider>
  );
  return userEvent.setup();
}

describe('TotpSection', () => {
  it('enrôle : QR code et clé en clair, puis codes de secours montrés une fois', async () => {
    const user = renderSection();
    await user.click(
      await screen.findByRole('button', {
        name: 'Activer la double authentification',
      })
    );

    const qr = await screen.findByRole('img', {
      name: 'QR code de configuration pour l’application d’authentification',
    });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    // Clé groupée par quatre, recopiable à la main.
    expect(
      screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
    ).toBeInTheDocument();
    // Le focus va à la consigne, pas au champ (le clavier cacherait le QR).
    expect(
      screen.getByText(
        'Scannez ce QR code avec l’application, ou recopiez la clé.'
      )
    ).toHaveFocus();

    const code = screen.getByLabelText('Code affiché par l’application');
    await user.type(code, '999999');
    await user.click(
      screen.getByRole('button', { name: 'Confirmer et activer' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Code invalide');

    await user.clear(code);
    await user.type(code, '123456');
    await user.click(
      screen.getByRole('button', { name: 'Confirmer et activer' })
    );

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(within(list).getByText('AAAA0-BBBBB')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText('Double authentification activée.')
      ).toBeInTheDocument()
    );

    await user.click(
      screen.getByRole('button', { name: 'J’ai rangé mes codes' })
    );
    expect(
      screen.getByText('Active — 10 code(s) de secours restant(s).')
    ).toBeInTheDocument();
    // Plus jamais affichés.
    expect(screen.queryByText('AAAA0-BBBBB')).not.toBeInTheDocument();
  });

  it('refuse localement ce qui n’est pas six chiffres', async () => {
    const user = renderSection();
    await user.click(
      await screen.findByRole('button', {
        name: 'Activer la double authentification',
      })
    );
    await screen.findByLabelText('Code affiché par l’application');
    await user.type(
      screen.getByLabelText('Code affiché par l’application'),
      '12a'
    );
    // `pattern` bloque l'envoi natif ; on soumet le formulaire directement,
    // pour éprouver la garde du composant elle-même.
    const form = screen
      .getByLabelText('Code affiché par l’application')
      .closest('form');
    if (!form) throw new Error('formulaire absent');
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saisissez les 6 chiffres affichés par l’application.'
    );
    expect(requests.some(r => r.url === '/api/auth/totp/activate')).toBe(false);
  });

  it('désactive avec le mot de passe ET un code', async () => {
    state = { enabled: true, pending: false, left: 2 };
    const user = renderSection();
    expect(
      await screen.findByText('Active — 2 code(s) de secours restant(s).')
    ).toBeInTheDocument();
    // Peu de codes restants : c'est signalé.
    expect(
      screen.getByText(/Il reste peu de codes de secours/)
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Mot de passe'), 'secret-solide');
    await user.type(
      screen.getByLabelText('Code (application ou secours)'),
      'AAAA3-BBBBB'
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Désactiver la double authentification',
      })
    );
    expect(
      await screen.findByRole('button', {
        name: 'Activer la double authentification',
      })
    ).toBeInTheDocument();
    expect(
      requests.find(r => r.url === '/api/auth/totp/disable')?.body
    ).toEqual({ password: 'secret-solide', code: 'AAAA3-BBBBB' });
  });
});
