/**
 * Sentry ne démarre qu'avec le même accord que PostHog. Sans clé PostHog,
 * personne ne pose la question : on démarre quand même, secrets filtrés.
 */
import {
  initSentry,
  setForwarder,
  setRedactKeys,
  type SentryBreadcrumb,
} from '@mister-guiiug/dev-pwa-config/react/observability';
import { scrubSecrets, scrubUnknown } from './scrubSecrets.ts';

type Closable = {
  captureException: (error: unknown, hint?: Record<string, unknown>) => void;
  close?: (timeout?: number) => Promise<boolean>;
  getClient?: () => {
    getOptions: () => {
      beforeSend?: (event: unknown, hint: unknown) => unknown;
    };
  };
};

let started: Promise<void> | null = null;
let sentry: Closable | null = null;

function scrubCrumb(crumb: SentryBreadcrumb): SentryBreadcrumb | null {
  const clean = scrubUnknown(crumb);
  if (!clean || typeof clean !== 'object') return null;
  return clean as SentryBreadcrumb;
}

export function enableSentry(): Promise<void> {
  if (started) return started;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    started = Promise.resolve();
    return started;
  }
  setRedactKeys(['authorization', 'cookie', 'pat', 'password', 'set-cookie']);
  started = (async () => {
    const loaded = (await initSentry({
      dsn,
      environment: import.meta.env.MODE,
      release: __APP_VERSION__,
      loader: () => import('@sentry/react'),
      beforeBreadcrumb: scrubCrumb,
    })) as Closable | null;
    if (!loaded) return;
    sentry = loaded;
    const options = loaded.getClient?.()?.getOptions();
    if (options) {
      const previous = options.beforeSend;
      options.beforeSend = (event, hint) => {
        const clean = scrubUnknown(event);
        return previous ? previous(clean, hint) : clean;
      };
    }
    setForwarder((error, context, breadcrumbs) => {
      const clean = new Error(scrubSecrets(error.message));
      clean.name = error.name;
      if (error.stack) clean.stack = scrubSecrets(error.stack);
      loaded.captureException(clean, {
        extra: scrubUnknown({ ...context, trail: breadcrumbs }) as Record<
          string,
          unknown
        >,
      });
    });
  })();
  return started;
}

export function disableSentry(): void {
  setForwarder(null);
  const current = sentry;
  sentry = null;
  started = null;
  void current?.close?.(0);
}
