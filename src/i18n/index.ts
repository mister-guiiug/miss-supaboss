import {
  createI18n,
  createTranslator,
  type I18nPaths,
} from '@mister-guiiug/dev-pwa-config/react/i18n';
import { messages, type Locale, type Messages } from './messages.ts';

const LOCALES = ['fr', 'en'] as const;
const FALLBACK_LOCALE: Locale = 'fr';
const STORAGE_KEY = 'supaboss_locale';

export const { I18nProvider, useI18n } = createI18n({
  messages,
  locales: LOCALES,
  fallbackLocale: FALLBACK_LOCALE,
  storageKey: STORAGE_KEY,
});

/** Locale persistée (miroir de celle du provider) pour le code hors-React. */
function persistedLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'fr' || stored === 'en') return stored;
  } catch {
    /* localStorage indisponible : on ignore */
  }
  return FALLBACK_LOCALE;
}

/**
 * Traducteur autonome pour le code NON-React (ex. le store zustand qui émet des
 * toasts) : lit la locale persistée par le provider afin que les messages
 * suivent la langue de l'UI. Typé sur `Messages`, comme le `t` du hook.
 */
export function translate(
  path: I18nPaths<Messages>,
  params?: Record<string, string | number>
): string {
  return createTranslator(
    messages,
    persistedLocale(),
    FALLBACK_LOCALE
  )(path, params);
}
