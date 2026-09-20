import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * CE QUE CE TEST VERROUILLE : que les écrans du menu soient demandés PENDANT
 * L'INACTIVITÉ — ni au montage, ni au clic — et jamais chez qui économise ses
 * données.
 *
 * Le mécanisme est celui du socle (`useIdlePrefetch`), et c'est chez lui qu'il
 * est éprouvé : une exécution par chargeur, rejets avalés, garde `saveData` et
 * 2g, délai minuté là où `requestIdleCallback` manque. Ce qui se joue ici est
 * le BRANCHEMENT : que `Shell` lui confie bien les trois morceaux, en UNE
 * demande, et pas un chargeur neuf à chaque rendu — le socle ne reconnaît un
 * chargeur qu'à son identité.
 */

/** Les modules qui se sont évalués depuis le dernier montage. */
const charges: string[] = [];

/**
 * Les trois modules que le préchargement doit tirer, remplacés par des doubles
 * qui NOTENT leur évaluation. Ni `Shell` ni ce qu'elle rend ne les importe
 * statiquement : s'ils s'évaluent, c'est que le préchargement les a demandés.
 */
const DOUBLES: Record<string, () => Record<string, unknown>> = {
  './features/accounts/AccountsScreen.tsx': () => {
    charges.push('accounts');
    return { AccountsScreen: () => null };
  },
  './features/quotas/QuotasScreen.tsx': () => {
    charges.push('quotas');
    return { QuotasScreen: () => null };
  },
  './features/settings/SettingsScreen.tsx': () => {
    charges.push('settings');
    return { SettingsScreen: () => null };
  },
};

const LES_TROIS = ['accounts', 'quotas', 'settings'];

/**
 * jsdom n'a pas `requestIdleCallback` : on le fournit, et c'est le test qui
 * décide QUAND le navigateur est au repos.
 */
function tenirLeRepos() {
  const rappels: Array<() => void> = [];
  vi.stubGlobal('requestIdleCallback', (fn: () => void) => rappels.push(fn));
  vi.stubGlobal('cancelIdleCallback', () => {});
  return {
    rappels,
    declencher: () => {
      for (const fn of rappels) fn();
    },
  };
}

/**
 * Un registre de modules VIERGE par montage, pour deux raisons. Le chargeur
 * composé de `App.tsx` est une constante de module que le socle ne relance
 * jamais : il doit être neuf. Et un module ne s'évalue qu'une fois par
 * registre — or `vi.resetModules` ÉPARGNE les modules moqués ; c'est
 * `vi.doMock` qui, en les enregistrant à nouveau, retire l'instance en cache
 * et fait réévaluer les doubles au prochain `import()`.
 */
async function monterLaCoquille() {
  vi.resetModules();
  for (const [chemin, double] of Object.entries(DOUBLES)) {
    vi.doMock(chemin, double);
  }
  const [{ Shell }, { I18nProvider }] = await Promise.all([
    import('./App.tsx'),
    import('./i18n/index.ts'),
  ]);
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<h1>Tableau de bord</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  );
}

/** Un chargement parti se verrait en quelques millisecondes : on lui laisse le temps qu'il ne prend pas. */
const laisserVenir = () => new Promise(resolve => setTimeout(resolve, 50));

const oublierLaConnexion = () => {
  delete (navigator as Navigator & { connection?: unknown }).connection;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  oublierLaConnexion();
  charges.length = 0;
});

describe('les écrans du menu se préchargent par le socle', () => {
  it("demande les trois morceaux à l'inactivité, en une fois, et pas avant", async () => {
    const repos = tenirLeRepos();
    await monterLaCoquille();

    // Au montage, rien : tout précharger au démarrage annulerait le découpage.
    expect(charges).toEqual([]);
    // UNE demande de repos, pas trois : un seul chargeur composé.
    expect(repos.rappels).toHaveLength(1);

    repos.declencher();

    await vi.waitFor(() => {
      expect([...charges].sort()).toEqual(LES_TROIS);
    });
  });

  it("n'en demande aucun chez qui économise ses données", async () => {
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: true },
      configurable: true,
    });
    const repos = tenirLeRepos();
    await monterLaCoquille();

    repos.declencher();
    await laisserVenir();

    expect(charges).toEqual([]);

    // LE TÉMOIN. Une absence ne prouve rien tant qu'on n'a pas vu la présence
    // dans les mêmes conditions : la contrainte levée, une nouvelle visite
    // charge bien les trois. Sans lui, des doubles qui auraient cessé de
    // noter feraient passer ce test à vide.
    cleanup();
    oublierLaConnexion();
    const visiteSuivante = tenirLeRepos();
    await monterLaCoquille();
    visiteSuivante.declencher();

    await vi.waitFor(() => {
      expect([...charges].sort()).toEqual(LES_TROIS);
    });
  });
});
