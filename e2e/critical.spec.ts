import { expect, test } from '@playwright/test';

/**
 * Parcours critiques en mode MOCK (aucun secret, aucun réseau Supabase).
 * Lancés par `npm run test:e2e` (webServer : dev:mock, port 5204).
 */

test('@critical le dashboard liste les comptes et leurs slots actifs', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Lab POC interne')).toBeVisible();
  await expect(page.getByText('Démos clients')).toBeVisible();
  await expect(page.getByText('2/2 actifs')).toBeVisible();
});

test('@critical préparer une démo propose les pauses puis restaure', async ({
  page,
}) => {
  await page.goto('/#/projects/acc-lab/hackathon-2026/demo');
  // Étape plan : limite atteinte → suggestion pré-cochée (crm-poc).
  await expect(
    page.getByText(/Limite Free atteinte|libérez un slot/i)
  ).toBeVisible();
  const launch = page.getByRole('button', {
    name: /Suspendre 1 projet\(s\) puis restaurer/,
  });
  await expect(launch).toBeVisible();
  await launch.click();
  await expect(page.getByText(/Restauration en cours/)).toBeVisible();
});

test('@critical la vue projets filtre par statut', async ({ page }) => {
  await page.goto('/#/projects');
  await page.getByRole('button', { name: 'En pause' }).click();
  await expect(page.getByText('Hackathon 2026')).toBeVisible();
  await expect(page.getByText('RAG IA Démo')).toBeHidden();
});

test('@critical les quotas affichent egress non disponible', async ({
  page,
}) => {
  await page.goto('/#/quotas');
  await expect(page.getByText('non disponible via API').first()).toBeVisible();
});
