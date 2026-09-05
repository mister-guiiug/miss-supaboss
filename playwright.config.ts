import { defineConfig, devices } from '@playwright/test';
import { definePwaPlaywrightConfig } from '@mister-guiiug/dev-pwa-config/playwright-base';

// Les E2E tournent en mode MOCK : parcours complet sans secret ni réseau.
const config = definePwaPlaywrightConfig({
  devices,
  port: 5204,
  command: 'npm run dev:mock -- --port 5204 --strictPort',
});
// Les specs assertent du texte français : depuis l'i18n (détection
// navigator.language), un navigateur en-US ferait rendre l'app en anglais.
// On force la locale FR pour des E2E déterministes.
// (le helper type `use` en unknown → cast pour la mutation)
(config.use as Record<string, unknown>).locale = 'fr-FR';

export default defineConfig(config);
