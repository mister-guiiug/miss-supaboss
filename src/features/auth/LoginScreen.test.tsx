import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.ts';
import { useSessionStore } from '../../store/useSessionStore.ts';
import { LoginScreen } from './LoginScreen.tsx';

/**
 * Connexion en deux temps, de l'écran au client HTTP réel : seul `fetch` est
 * simulé, avec les réponses du serveur.
 */
interface Call {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

let calls: Call[];
let secondStep: (body: unknown) => Response;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const USER = { id: 'u1', email: 'admin@local', role: 'admin' };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('supaboss_locale', 'fr');
  useSessionStore.setState({
    status: 'anonymous',
    user: null,
    totpPending: false,
  });
  calls = [];
  secondStep = () => json(200, { user: USER });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = init.body
        ? (JSON.parse(String(init.body)) as unknown)
        : null;
      calls.push({
        url,
        body,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      if (url === '/api/auth/login') return json(200, { totpRequired: true });
      if (url === '/api/auth/login/totp') return secondStep(body);
      return json(404, { error: 'not-found', message: 'Route inconnue' });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function passwordStep() {
  const user = userEvent.setup();
  render(
    <I18nProvider>
      <LoginScreen />
    </I18nProvider>
  );
  await user.type(screen.getByLabelText('E-mail'), 'admin@local');
  await user.type(screen.getByLabelText('Mot de passe'), 'secret-solide');
  await user.click(screen.getByRole('button', { name: 'Se connecter' }));
  await screen.findByRole('heading', { name: 'Vérification en deux étapes' });
  return user;
}

describe('LoginScreen — double authentification', () => {
  it('mot de passe juste : pas de session, une seconde étape, le focus sur le code', async () => {
    await passwordStep();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'anonymous',
      totpPending: true,
    });
    const code = screen.getByLabelText('Code à 6 chiffres');
    expect(code).toHaveFocus();
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
  });

  it('code refusé : message ; code juste : session ouverte', async () => {
    let attempts = 0;
    secondStep = () => {
      attempts += 1;
      return attempts === 1
        ? json(401, { error: 'bad-totp', message: 'Code invalide' })
        : json(200, { user: USER });
    };
    const user = await passwordStep();

    await user.type(screen.getByLabelText('Code à 6 chiffres'), '000000');
    await user.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Code invalide ou déjà utilisé.'
    );

    await user.clear(screen.getByLabelText('Code à 6 chiffres'));
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '123456');
    await user.click(screen.getByRole('button', { name: 'Vérifier' }));
    await waitFor(() =>
      expect(useSessionStore.getState().status).toBe('authenticated')
    );
    const last = calls.at(-1);
    expect(last?.url).toBe('/api/auth/login/totp');
    expect(last?.body).toEqual({ code: '123456' });
    // Mutation : l'en-tête anti-CSRF part avec.
    expect(last?.headers['x-supaboss-csrf']).toBe('1');
  });

  it('code de secours : la seconde voie', async () => {
    const user = await passwordStep();
    await user.click(
      screen.getByRole('button', { name: 'Utiliser un code de secours' })
    );
    await user.type(screen.getByLabelText('Code de secours'), 'ABCDE-FGHJK');
    await user.click(screen.getByRole('button', { name: 'Vérifier' }));
    await waitFor(() =>
      expect(useSessionStore.getState().status).toBe('authenticated')
    );
    expect(calls.at(-1)?.body).toEqual({ recoveryCode: 'ABCDE-FGHJK' });
  });

  it('étape expirée : retour au mot de passe, avec la raison', async () => {
    secondStep = () =>
      json(401, { error: 'totp-expired', message: 'Étape expirée' });
    const user = await passwordStep();
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '123456');
    await user.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Étape expirée : saisissez à nouveau votre mot de passe.'
    );
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeVisible();
    expect(useSessionStore.getState().totpPending).toBe(false);
  });

  it('trop d’essais (429) : dit tel quel', async () => {
    secondStep = () =>
      json(429, { error: 'rate-limited', message: 'Trop de requêtes' });
    const user = await passwordStep();
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '123456');
    await user.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Trop d’essais : patientez une minute.'
    );
  });

  it('« Revenir au mot de passe » abandonne l’étape', async () => {
    const user = await passwordStep();
    await user.click(
      screen.getByRole('button', { name: 'Revenir au mot de passe' })
    );
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeVisible();
    expect(useSessionStore.getState().totpPending).toBe(false);
  });
});
