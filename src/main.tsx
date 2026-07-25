import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  installErrorReporter,
  initSentry,
} from '@mister-guiiug/dev-wpa-config/react/observability';
import { App } from './App.tsx';
import './index.css';

installErrorReporter();
void initSentry({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
});

const container = document.getElementById('root');
if (!container) throw new Error('#root introuvable');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
