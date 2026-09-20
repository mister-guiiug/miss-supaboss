import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lazy, type ComponentType } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from './i18n/index.ts';
import { Shell } from './App.tsx';

/**
 * CE QUE CE TEST VERROUILLE : que le clic sur une entrée du menu réponde.
 *
 * Il tient une propriété qui ne se lit nulle part dans le code, et qu'aucun
 * autre test ne protège. Onze dépôts du parc portent le couple `React.lazy` +
 * react-router 7 ; sur six d'entre eux, un clic de menu ne produit RIEN de
 * visible pendant tout l'aller-retour réseau du morceau — mesuré à froid le
 * 20/09/2026 sur deux sites publiés : 133 ms sur mister-settle, 161 ms sur
 * mister-molkky, écran précédent figé, `aria-busy` faux d'un bout à l'autre.
 *
 * La cause : react-router 7 enveloppe tout changement d'URL dans
 * `startTransition`, et React 19 garde alors délibérément l'écran déjà affiché
 * plutôt que de montrer le repli de `<Suspense>`. Le repli devient du code mort
 * au clic.
 *
 * MISS-SUPABOSS Y ÉCHAPPE, PAR ACCIDENT. `ObservabilityBoundary` porte
 * `key={pathname}` — posé pour isoler les erreurs par route — donc la frontière
 * `Suspense` qu'elle contient est RE-MONTÉE à chaque navigation. Le repli d'une
 * frontière NEUVE paraît même au sein d'une transition : le squelette répond
 * donc au clic.
 *
 * Retirer ce `key` (un nettoyage plausible : « la frontière n'a pas besoin de
 * se remonter ») rendrait le clic muet sans casser aucun autre test. D'où
 * celui-ci.
 */

/** Monte la coquille face à un écran dont on décide nous-même de l'arrivée. */
function monterFaceAUnEcranLent() {
  let resous!: () => void;
  const EcranLent = lazy(
    () =>
      new Promise<{ default: ComponentType }>(resolve => {
        resous = () => resolve({ default: () => <h1>Les comptes</h1> });
      })
  );

  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<h1>Tableau de bord</h1>} />
            <Route path="accounts" element={<EcranLent />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  );

  return {
    // Une expression régulière, pas une chaîne : le socle ajoute « Page
    // actuelle » au nom accessible de l'entrée courante.
    entree: (nom: RegExp) => screen.getByRole('link', { name: nom }),
    livreLEcran: async () => {
      await act(async () => {
        resous();
      });
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  // Force la locale FR : jsdom rapporte `navigator.language = en-US`.
  localStorage.setItem('supaboss_locale', 'fr');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('le clic sur une entrée du menu répond', () => {
  it("montre le repli de route tant que l'écran n'est pas arrivé", async () => {
    const { entree, livreLEcran } = monterFaceAUnEcranLent();

    expect(
      screen.getByRole('heading', { name: 'Tableau de bord' })
    ).toBeInTheDocument();

    fireEvent.click(entree(/Comptes/));

    // LE POINT DE TOUT LE TEST. L'écran précédent a cédé la place au squelette
    // du `Suspense` — ce qui n'arrive QUE parce que la frontière est re-montée
    // par `key={pathname}`. Sans ce `key`, React garderait « Tableau de bord »
    // à l'écran pendant tout l'aller-retour, sans rien dire.
    expect(
      screen.queryByRole('heading', { name: 'Tableau de bord' })
    ).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    await livreLEcran();

    expect(
      screen.getByRole('heading', { name: 'Les comptes' })
    ).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('garde la barre de navigation sous les yeux pendant le chargement', () => {
    const { entree } = monterFaceAUnEcranLent();

    fireEvent.click(entree(/Comptes/));

    // Ce qui dit « je charge » doit survivre au clic : la barre est hors de la
    // frontière re-montée, donc elle reste.
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(entree(/Comptes/)).toBeInTheDocument();
  });
});
