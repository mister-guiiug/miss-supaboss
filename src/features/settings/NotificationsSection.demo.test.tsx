import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.ts';
import { NotificationsSection } from './NotificationsSection.tsx';
import { TotpSection } from './TotpSection.tsx';

/**
 * La DÉMO (GitHub Pages) : l'API est le vrai mock, qui garde les réglages et
 * n'envoie rien. L'écran doit le DIRE, pas seulement griser des boutons.
 */
vi.mock('../../api/index.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../../api/index.ts')>();
  const { createMockApi } = await import('../../mock/mockApi.ts');
  return { ...original, IS_MOCK: true, api: createMockApi() };
});

beforeEach(() => {
  localStorage.setItem('supaboss_locale', 'fr');
});

function renderAll() {
  render(
    <I18nProvider>
      <NotificationsSection />
      <TotpSection />
    </I18nProvider>
  );
  return userEvent.setup();
}

describe('Réglages en démo', () => {
  it('notifications : réglages visibles, envoi impossible, et c’est écrit', async () => {
    const user = renderAll();
    expect(
      await screen.findByText(/^Démo : les réglages restent sur cet appareil/)
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Indisponible en démo : il faut le serveur pour envoyer.'
      )
    ).toBeInTheDocument();
    const test = screen.getByRole('button', {
      name: 'Envoyer une notification de test',
    });
    expect(test).toBeDisabled();
    expect(test).toHaveAccessibleDescription(
      'Le test demande le serveur Miss Supaboss.'
    );

    // Le webhook se règle quand même — en abrégé, rien n'en partira.
    await user.type(
      screen.getByLabelText('URL https du webhook'),
      'https://hooks.example.test/services/secret-abcd'
    );
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer le webhook' })
    );
    expect(
      await screen.findByText(
        'Webhook enregistré : https://hooks.example.test/…abcd'
      )
    ).toBeInTheDocument();
  });

  it('double authentification : sans objet, et dit pourquoi', async () => {
    renderAll();
    expect(
      await screen.findByText(/La double authentification protège la connexion/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Activer la double authentification',
      })
    ).not.toBeInTheDocument();
  });
});
