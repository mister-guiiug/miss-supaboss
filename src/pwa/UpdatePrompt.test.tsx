import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/index.ts';
import { UpdatePrompt } from './UpdatePrompt.tsx';

// Remplace le mock inerte du setup partagé : capture le callback que le hook
// passe à `registerSW`, pour simuler un service worker en attente. Le hook ne
// connecte `registerSW` qu'une fois par identité de fonction (WeakMap du
// socle) : la capture du premier rendu vaut pour tout le fichier.
const sw = vi.hoisted(() => ({
  onNeedRefresh: undefined as (() => void) | undefined,
}));
vi.mock('virtual:pwa-register', () => ({
  registerSW: (options?: { onNeedRefresh?: () => void }) => {
    sw.onNeedRefresh = options?.onNeedRefresh;
    return () => Promise.resolve();
  },
}));

function renderPrompt() {
  return render(
    <I18nProvider>
      <UpdatePrompt />
    </I18nProvider>
  );
}

describe('UpdatePrompt', () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom expose `navigator.language` en anglais : on épingle la locale
    // persistée pour des libellés déterministes.
    localStorage.setItem('supaboss_locale', 'fr');
  });

  it("reste masqué tant que le SW ne signale rien, puis s'affiche", async () => {
    renderPrompt();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // La régression d'origine : sans `registerSW` injecté, le hook n'appelait
    // jamais l'enregistrement et `onNeedRefresh` restait lettre morte.
    expect(sw.onNeedRefresh).toBeTypeOf('function');

    act(() => sw.onNeedRefresh?.());

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Mise à jour disponible.'
    );
    expect(
      screen.getByRole('button', { name: 'Recharger' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Plus tard' })
    ).toBeInTheDocument();
  });

  it('« Plus tard » masque le bandeau et persiste un report de 24 h', async () => {
    const user = userEvent.setup();
    renderPrompt();
    act(() => sw.onNeedRefresh?.());

    await user.click(await screen.findByRole('button', { name: 'Plus tard' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    const until = Number(localStorage.getItem('dwc_sw_update_snoozed_until'));
    expect(until).toBeGreaterThan(Date.now());
    expect(until).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000);
  });
});
