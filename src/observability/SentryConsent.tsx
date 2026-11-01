import { useEffect } from 'react';
import { useConsentChoice } from '@mister-guiiug/dev-pwa-config/react/consent-banner';
import { disableSentry, enableSentry } from './sentryGate.ts';

/**
 * Branche Sentry sur le choix du bandeau. Tant que la question est ouverte
 * ou refusée, aucun envoi. Sans identifiant PostHog, le bandeau n'existe pas :
 * Sentry part, toujours filtré.
 */
export function SentryConsent() {
  const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
  const { choice } = useConsentChoice({
    posthogKey,
    loader: () => import('posthog-js/dist/module.slim.js'),
  });

  useEffect(() => {
    const asks = Boolean(posthogKey);
    if (!asks || choice === 'granted') {
      void enableSentry();
      return;
    }
    disableSentry();
  }, [choice, posthogKey]);

  return null;
}
