import { defineConfig, devices } from '@playwright/test';
import { definePwaPlaywrightConfig } from '@mister-guiiug/dev-wpa-config/playwright-base';

// Les E2E tournent en mode MOCK : parcours complet sans secret ni réseau.
export default defineConfig(
  definePwaPlaywrightConfig({
    devices,
    port: 5204,
    command: 'npm run dev:mock -- --port 5204 --strictPort',
  })
);
