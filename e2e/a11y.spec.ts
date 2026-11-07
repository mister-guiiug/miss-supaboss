// Suite a11y (axe-core + Playwright), en mode MOCK comme les parcours critiques.
//
// Le tag @a11y permet de filtrer en CI : `playwright test --grep @a11y`.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  expectNoA11yViolations,
  expectNoA11yViolationsOn,
} from '@mister-guiiug/dev-pwa-config/playwright-a11y';

/** Attend qu'un texte de l'écran réel soit là avant de lancer axe. */
const voir = (texte: RegExp | string) => async (page: Page) => {
  await expect(page.getByText(texte).first()).toBeVisible();
};

test.describe('@a11y accessibilité', () => {
  test("page d'accueil sans violation WCAG A/AA", async ({ page }) => {
    await page.goto('/');
    await expectNoA11yViolations(page, AxeBuilder, expect);
  });

  // L'accueil seul laissait dehors tout ce qui se manipule : la liste des
  // projets et ses filtres, les quotas, la préparation d'une démo.
  test('projets, filtre, quotas et préparation de démo sans violation WCAG A/AA', async ({
    page,
  }) => {
    await expectNoA11yViolationsOn(page, AxeBuilder, expect, [
      { name: 'projets', path: '/#/projects', setup: voir('RAG IA Démo') },
      {
        name: 'projets filtrés « En pause »',
        setup: async p => {
          await p.getByRole('button', { name: /^En pause/ }).click();
          await expect(p.getByText('Hackathon 2026')).toBeVisible();
        },
      },
      {
        name: 'quotas',
        path: '/#/quotas',
        setup: voir(/non disponible via l'API/i),
      },
      {
        name: 'préparer une démo',
        path: '/#/projects/acc-lab/hackathon-2026/demo',
        setup: voir(/Limite Free atteinte|libérez un slot/i),
      },
    ]);
  });
});
