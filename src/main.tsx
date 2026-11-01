import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installErrorReporter } from '@mister-guiiug/dev-pwa-config/react/observability';
import { App } from './App.tsx';
import { I18nProvider } from './i18n/index.ts';
import './index.css';

installErrorReporter();
// Sentry attend le même accord que PostHog (`SentryConsent` dans App).
// Le `loader` analysable reste dans `sentryGate.ts`, pour le morceau dédié.

const container = document.getElementById('root');
if (!container) throw new Error('#root introuvable');

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>
);
