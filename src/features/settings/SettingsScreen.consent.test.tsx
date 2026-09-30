import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAnalyticsLoaded,
  resetAnalytics,
} from '@mister-guiiug/dev-pwa-config/analytics';
import {
  readConsentChoice,
  writeConsentChoice,
} from '@mister-guiiug/dev-pwa-config/react/consent-banner';
import { CLE_DE_TEST } from '@mister-guiiug/dev-pwa-config/testing/posthog';
import { I18nProvider } from '../../i18n/index.ts';
import { SettingsScreen } from './SettingsScreen.tsx';

/**
 * REVENIR SUR SON CHOIX DE MESURE D'AUDIENCE, DEPUIS LES RÉGLAGES.
 *
 * Le bandeau recueille l'accord ; rien ne permettait de le retirer, sinon
 * d'effacer les données du site. L'article 7.3 du RGPD veut que retirer soit
 * aussi simple que donner : un clic, ici, sur le VRAI écran.
 */

// La vraie bibliothèque, initialisée dans jsdom, partirait interroger PostHog.
vi.mock('posthog-js/dist/module.slim.js', async () => {
  const { fauxPosthog } =
    await import('@mister-guiiug/dev-pwa-config/testing/posthog');
  return { default: fauxPosthog() };
});

// LA CI INJECTE `VITE_MOCK=1` AVANT LES TESTS, et `IS_MOCK` se calcule au
// chargement du module : l'API est épinglée sur le mock intégral, pour que
// l'écran monte ici comme en CI — et sans réseau.
vi.mock('../../api/index.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../../api/index.ts')>();
  const { createMockApi } = await import('../../mock/mockApi.ts');
  return { ...original, IS_MOCK: true, api: createMockApi() };
});

function mount(locale: 'fr' | 'en' = 'fr') {
  localStorage.setItem('supaboss_locale', locale);
  render(
    <I18nProvider>
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>
    </I18nProvider>
  );
}

beforeEach(() => {
  // Le setup partagé ne vide pas le stockage : un choix fuirait d'un test à
  // l'autre.
  localStorage.clear();
  vi.stubEnv('VITE_POSTHOG_KEY', CLE_DE_TEST);
  // L'état de la mesure est celui d'un module : il survit d'un test à l'autre.
  resetAnalytics();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('réglages : la mesure d’audience', () => {
  it('permettent de retirer son consentement, en un clic', async () => {
    writeConsentChoice('granted');
    mount();

    const titre = await screen.findByRole('heading', {
      name: 'Mesure d’audience',
    });
    const section = titre.closest('section')!;
    expect(within(section).getByRole('status')).toHaveTextContent(
      'Vous avez accepté cette mesure.'
    );
    // L'accord d'hier, rejoué au montage, a chargé la bibliothèque.
    await waitFor(() => expect(isAnalyticsLoaded()).toBe(true));

    fireEvent.click(
      within(section).getByRole('button', { name: 'Retirer mon consentement' })
    );

    expect(readConsentChoice()).toBe('denied');
    const posthog = (await import('posthog-js/dist/module.slim.js')).default;
    expect(posthog.has_opted_out_capturing()).toBe(true);
    expect(within(section).getByRole('status')).toHaveTextContent(
      'Vous avez refusé cette mesure.'
    );
  });

  it('parlent la langue de l’app : en anglais, « Withdraw my consent »', async () => {
    writeConsentChoice('granted');
    mount('en');

    const titre = await screen.findByRole('heading', {
      name: 'Audience measurement',
    });
    expect(
      within(titre.closest('section')!).getByRole('button', {
        name: 'Withdraw my consent',
      })
    ).toBeInTheDocument();
    // Le chargement rejoué s'achève ICI, et non dans le test suivant.
    await waitFor(() => expect(isAnalyticsLoaded()).toBe(true));
  });
});
