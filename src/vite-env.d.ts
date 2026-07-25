/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** « 1 » : démo sans backend (fixtures locales, GitHub Pages). */
  readonly VITE_MOCK?: string;
  /** DSN Sentry (optionnel) : vide = observabilité locale seule (no-op). */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
