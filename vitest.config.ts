import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import {
  baseTestOptions,
  coveragePreset,
} from '@mister-guiiug/dev-wpa-config/vitest-base';

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
      include: ['shared/**', 'server/src/**', 'src/domain/**'],
      thresholds: { statements: 60, branches: 75, functions: 65, lines: 60 },
    },
    projects: [
      {
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
