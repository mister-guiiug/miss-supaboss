import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import {
  baseTestOptions,
  coveragePreset,
  pwaRegisterAlias,
} from '@mister-guiiug/dev-pwa-config/vitest-base';

// `passWithNoTests` n'est valable qu'au niveau racine en Vitest 4.
const { passWithNoTests, ...uiTestBase } = baseTestOptions;

// Deux projets : UI (jsdom) et serveur (node, sans setup jsdom).
export default defineConfig({
  plugins: [react()],
  test: {
    passWithNoTests,
    coverage: {
      ...coveragePreset,
      provider: 'v8',
      include: ['shared/**', 'server/src/**', 'shared/fleet/**'],
      thresholds: { statements: 60, branches: 75, functions: 65, lines: 60 },
    },
    projects: [
      {
        // `virtual:pwa-register` n'est fourni que par vite-plugin-pwa,
        // absent d'ici : sans ce double, tout test qui importe `UpdatePrompt`
        // échoue à l'import. À poser DANS le projet `app` — les projets inline
        // n'héritent pas du `resolve` racine. Le double du socle est PILOTABLE
        // (`swStub.needRefresh()`), là où la copie locale était muette.
        resolve: { alias: { ...pwaRegisterAlias } },
        test: {
          ...uiTestBase,
          name: 'app',
          include: [
            'src/**/*.{test,spec}.{ts,tsx}',
            'shared/**/*.{test,spec}.ts',
          ],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          globals: true,
          include: ['server/test/**/*.{test,spec}.ts'],
        },
      },
    ],
  },
});
