import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  version: string;
};

// Déployé en mode mock sur GitHub Pages : https://mister-guiiug.github.io/miss-supaboss/
// En mode réel, le build est servi par le serveur Node (même origine que /api).
export default defineConfig(({ command, mode }) => {
  const basePath =
    process.env.VITE_BASE_PATH ??
    (command === 'build' ? '/miss-supaboss/' : '/');

  // Origine du proxy Supabase (mode réel local-first) à autoriser dans la CSP
  // `connect-src`. loadEnv lit les .env* ET le process.env (build-env de la CI).
  // Vide (mode démo/mock) → connect-src reste 'self'.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  let proxyOrigin = '';
  try {
    if (env.VITE_SUPABASE_PROXY) {
      proxyOrigin = new URL(env.VITE_SUPABASE_PROXY).origin;
    }
  } catch {
    proxyOrigin = '';
  }

  return {
    base: basePath,
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    server: {
      // Dev full-stack : `npm run dev:server` écoute sur 8787.
      proxy: {
        '/api': 'http://localhost:8787',
      },
    },
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return;
            const norm = id.replace(/\\/g, '/');
            if (norm.includes('/lucide-react/')) return 'icons';
            if (
              norm.includes('/react-dom/') ||
              norm.includes('/node_modules/react/') ||
              norm.includes('/scheduler/')
            ) {
              return 'react-vendor';
            }
            if (norm.includes('/react-router')) return 'router';
            if (norm.includes('/zustand/')) return 'zustand';
            if (norm.includes('/zod/')) return 'zod';
            return 'vendor';
          },
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable.png'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2,webmanifest}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 4_000_000,
          // Les réponses /api ne sont JAMAIS mises en cache par le SW :
          // le « dernier état connu » est géré applicativement (IndexedDB),
          // jamais d'action destructive rejouée hors ligne.
          navigateFallbackDenylist: [/^\/api\//],
        },
        manifest: {
          id: '/miss-supaboss/',
          name: 'Miss Supaboss — Pilotage Supabase Free',
          short_name: 'Supaboss',
          description:
            'Pilote tes comptes Supabase Free : inventaire des projets, pause/restore à la demande, quotas Free Plan et préparation de démo.',
          theme_color: '#0c1222',
          background_color: '#0c1222',
          display: 'standalone',
          orientation: 'portrait',
          scope: basePath,
          start_url: basePath,
          lang: 'fr',
          dir: 'ltr',
          categories: ['developer', 'productivity', 'utilities'],
          shortcuts: [
            {
              name: 'Projets',
              short_name: 'Projets',
              url: `${basePath}#/projects`,
            },
            {
              name: 'Quotas',
              short_name: 'Quotas',
              url: `${basePath}#/quotas`,
            },
            {
              name: 'Historique',
              short_name: 'Historique',
              url: `${basePath}#/history`,
            },
          ],
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
      // Étend la CSP `connect-src` avec l'origine du proxy quand
      // VITE_SUPABASE_PROXY est défini (mode réel local-first) — sinon laisse
      // 'self' (démo/mock). Une seule source de vérité : la variable de build.
      {
        name: 'csp-connect-proxy',
        transformIndexHtml(html: string) {
          return proxyOrigin
            ? html.replace(
                "connect-src 'self'",
                `connect-src 'self' ${proxyOrigin}`
              )
            : html;
        },
      },
    ],
  };
});
