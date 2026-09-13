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
      // `server/src/index.ts` est le POINT D'ENTRÉE, et le seul du périmètre :
      // `main()` s'auto-invoque à l'import, ouvre le port, pose les gestionnaires
      // de SIGINT/SIGTERM et sort par `process.exit`. L'importer depuis un test
      // démarrerait un serveur. Même raison que le `src/main.tsx` exclu par
      // `mister-footcoach`.
      //
      // Rien d'autre n'est sorti du périmètre, et surtout pas
      // `supabase/http.ts` ni `supabase/management.ts` : ils déclarent
      // `fetchImpl` et `sleep` « injectable pour les tests », les points
      // d'injection étaient posés et les tests manquaient — c'est une dette,
      // pas une frontière.
      exclude: [...coveragePreset.exclude, 'server/src/index.ts'],
      // Ces seuils n'étaient VÉRIFIÉS NULLE PART jusqu'au 13/09/2026 : la CI
      // lance `npm run test`, sans `--coverage`, donc Vitest ne mesurait rien
      // et ne comparait rien. Et ils n'étaient pas non plus une calibration :
      // 60 / 75 / 65 / 60 est mot pour mot `recommendedThresholds` du socle,
      // adopté tel quel et jamais confronté à ce dépôt — qui était à
      // 70,26 / 59,39 / 76,00 / 71,18, donc sous le plancher des branches.
      //
      // Les valeurs ci-dessous sont MESURÉES ici, deux points sous le relevé
      // du jour (89,02 / 78,30 / 89,44 / 89,84) plutôt qu'à la mesure exacte :
      // `mister-footcoach` cale les siens au centième, et sa CI est passée au
      // rouge sans qu'une ligne bouge, un Rolldown plus récent ayant fait
      // sortir du rapport des sous-arbres entièrement couverts.
      thresholds: { statements: 87, branches: 76, functions: 87, lines: 87 },
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
