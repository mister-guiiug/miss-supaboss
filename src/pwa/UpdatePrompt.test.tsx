import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/index.ts';
import { UpdatePrompt } from './UpdatePrompt.tsx';

// Remplace le mock inerte du setup partagé : capture le callback que le socle
// passe à `registerSW`, pour simuler un service worker en attente. Le socle ne
// connecte `registerSW` qu'une fois par identité de fonction (WeakMap) : la
// capture du premier rendu vaut pour tout le fichier.
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
    // La régression d'origine : sans `registerSW` injecté, le composant du
    // socle n'appelle jamais l'enregistrement et `onNeedRefresh` reste lettre
    // morte — le bandeau ne peut alors PAS s'afficher, quoi qu'il arrive.
    expect(sw.onNeedRefresh).toBeTypeOf('function');

    act(() => sw.onNeedRefresh?.());

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Mise à jour disponible.');
    // Crochet de style du socle : sans lui, `components.css` (importé par
    // `src/index.css`) n'habillerait rien et le bandeau serait nu.
    expect(banner).toHaveAttribute('data-dwc', 'update-banner');
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

  it('traduit ses libellés (locale anglaise)', async () => {
    localStorage.setItem('supaboss_locale', 'en');
    renderPrompt();
    act(() => sw.onNeedRefresh?.());

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Update available.'
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
  });
});
