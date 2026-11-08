import { expect, test } from '@playwright/test';

/**
 * Parcours critiques en mode MOCK (aucun secret, aucun réseau Supabase).
 * Lancés par `npm run test:e2e` (webServer : dev:mock, port 5204).
 */

test('@critical le dashboard liste les projets actifs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('CRM POC').first()).toBeVisible();
  await expect(page.getByText('RAG IA Démo').first()).toBeVisible();
  await expect(page.getByText('Pitch Retail').first()).toBeVisible();
  await expect(page.getByText('Hackathon 2026')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Voir tous les quotas' })
  ).toBeVisible();
});

test('@critical le dashboard signale les quotas proches du seuil', async ({
  page,
}) => {
  await page.goto('/');
  const alerts = page.getByRole('region', { name: 'Alertes quotas' });
  await expect(alerts).toBeVisible();
  await expect(alerts.getByText('RAG IA Démo')).toBeVisible();
  await expect(
    alerts.getByRole('link', { name: /Database size 361 Mo \/ 500 Mo/ })
  ).toBeVisible();
  await alerts.getByRole('link').first().click();
  await expect(page).toHaveURL(/#\/projects\/acc-lab\/rag-ia-demo$/);
});

test('@critical la page quotas relie les mesures à leur projet', async ({
  page,
}) => {
  await page.goto('/#/quotas');
  const watch = page.getByRole('region', {
    name: 'Mesures au-dessus du seuil',
  });
  await expect(watch).toBeVisible();
  await expect(
    watch.getByRole('link', { name: /RAG IA Démo Database size/ })
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Quotas Lab POC interne' })
  ).toBeVisible();
});

test('@critical les actions du projet restent accessibles dans les détails', async ({
  page,
}) => {
  await page.goto('/#/projects/acc-lab/rag-ia-demo');
  const details = page.getByText('Détails', { exact: true });
  await expect(details).toBeVisible();
  await details.click();
  await expect(page.getByRole('button', { name: /Favori/ })).toBeVisible();
  await expect(page.getByRole('switch', { name: /keep-alive/i })).toBeVisible();
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
  await page.getByRole('button', { name: /^En pause/ }).click();
  await expect(page.getByText('Hackathon 2026')).toBeVisible();
  await expect(page.getByText('RAG IA Démo')).toBeHidden();
});

test('@critical les quotas affichent egress non disponible', async ({
  page,
}) => {
  await page.goto('/#/quotas');
  await expect(
    page.getByText(/non disponible via l'API/i).first()
  ).toBeVisible();
});
