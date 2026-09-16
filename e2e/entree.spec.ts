import { test, expect } from '@playwright/test';
import { expectEcranEntreeCable } from '@mister-guiiug/dev-pwa-config/playwright-entree';

/*
 * L'ÉCRAN D'ENTRÉE, VÉRIFIÉ LÀ OÙ IL CASSE.
 *
 * Trois fois en un mois, une pièce à effet de bord s'est retrouvée montée
 * DERRIÈRE la porte d'une app du parc : `registerSW` d'abord, le bandeau de
 * consentement ensuite, la vue de page enfin. À chaque fois le composant était
 * bien écrit, la CI verte, et le défaut trouvé EN PRODUCTION. Cette spec ne
 * teste pas un composant, elle teste une PLACE.
 *
 * `serviceWorker: false` ICI, et seulement ici : les e2e de cette app tournent
 * contre un serveur de DÉVELOPPEMENT, où Vite n'enregistre pas de service
 * worker. Le vérifier échouerait pour une raison qui n'a rien à voir avec le
 * montage des composants.
 */
test.describe('@critical écran d’entrée', () => {
  test('la question est posée et une vue de page part', async ({ page }) => {
    await expectEcranEntreeCable(page, expect, {
      url: '/',
      serviceWorker: false,
    });
  });
});
