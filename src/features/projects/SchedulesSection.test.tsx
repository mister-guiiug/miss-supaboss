import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.ts';
import { getQueryClient } from '../../shared/queries/client.ts';
import { useSessionStore } from '../../store/useSessionStore.ts';
import { SchedulesSection } from './SchedulesSection.tsx';

/**
 * Plannings sur l'écran projet, en DÉMO : le vrai mock, qui les garde sur
 * l'appareil et ne les exécute jamais — l'écran doit le dire.
 */
vi.mock('../../api/index.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../../api/index.ts')>();
  const { createMockApi } = await import('../../mock/mockApi.ts');
  return { ...original, IS_MOCK: true, api: createMockApi() };
});

const ADMIN = { id: 'demo', email: 'demo@miss-supaboss.app', role: 'admin' };

beforeEach(() => {
  localStorage.setItem('supaboss_locale', 'fr');
  useSessionStore.setState({ status: 'authenticated', user: ADMIN as never });
});

afterEach(() => {
  getQueryClient().clear();
});

function renderSection() {
  render(
    <QueryClientProvider client={getQueryClient()}>
      <I18nProvider>
        <SchedulesSection accountId="acc-lab" projectRef="crm-poc" />
      </I18nProvider>
    </QueryClientProvider>
  );
  return userEvent.setup();
}

describe('SchedulesSection — démo', () => {
  it('dit honnêtement que rien ne s’exécutera, puis ajoute et supprime', async () => {
    const user = renderSection();
    expect(
      screen.getByText(/^Démo : les plannings sont gardés sur cet appareil/)
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Aucun planning pour ce projet.')
    ).toBeInTheDocument();

    // Par défaut : « mettre en pause chaque vendredi à 19:00, Europe/Paris ».
    expect(
      screen.getByRole('radio', { name: 'Mettre en pause' })
    ).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Chaque semaine' })).toBeChecked();
    expect(screen.getByLabelText('Jour')).toHaveValue('5');
    expect(screen.getByLabelText('Heure')).toHaveValue('19:00');
    expect(screen.getByLabelText('Fuseau horaire')).toHaveValue('Europe/Paris');
    await user.click(
      screen.getByRole('button', { name: 'Ajouter le planning' })
    );

    const list = await screen.findByRole('list', { name: 'Plannings' });
    const item = within(list).getByRole('listitem');
    expect(item).toHaveTextContent('Pause chaque vendredi à 19:00');
    expect(item).toHaveTextContent('(Europe/Paris)');
    expect(item).toHaveTextContent(/Prochaine exécution :/);

    await user.click(
      within(item).getByRole('button', {
        name: 'Supprimer le planning « Pause chaque vendredi à 19:00 »',
      })
    );
    await waitFor(() =>
      expect(
        screen.getByText('Aucun planning pour ce projet.')
      ).toBeInTheDocument()
    );
  });

  it('ponctuel déjà passé : le refus du garde-fou s’affiche', async () => {
    const user = renderSection();
    await screen.findByText('Aucun planning pour ce projet.');
    await user.click(screen.getByRole('radio', { name: 'Une fois' }));
    const at = screen.getByLabelText('Date et heure');
    await user.clear(at);
    await user.type(at, '2020-01-01T10:00');
    await user.click(
      screen.getByRole('button', { name: 'Ajouter le planning' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cette échéance est déjà passée'
    );
  });

  it('lecteur (viewer) : la liste, pas le formulaire', async () => {
    useSessionStore.setState({
      user: { ...ADMIN, role: 'viewer' } as never,
    });
    renderSection();
    expect(
      await screen.findByText(
        'Lecture seule : votre rôle (viewer) ne permet pas de planifier.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Ajouter le planning' })
    ).not.toBeInTheDocument();
  });
});
