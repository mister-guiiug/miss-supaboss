import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useSessionStore } from './store/useSessionStore.ts';
import { useFleetStore } from './store/useFleetStore.ts';
import { api, IS_MOCK } from './api/index.ts';
import { useFleetBootstrap } from './shared/queries/fleet.ts';
import { AppHeader } from './shared/components/AppHeader.tsx';
import { BottomNav } from './shared/components/BottomNav.tsx';
import { ErrorBoundary } from './shared/components/ErrorBoundary.tsx';
import { ToastViewport } from './shared/components/ToastViewport.tsx';
import { ListSkeleton } from './shared/components/Skeleton.tsx';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';
import { LoginScreen } from './features/auth/LoginScreen.tsx';
import { UnlockScreen } from './features/auth/UnlockScreen.tsx';
import { OfflineScreen } from './features/offline/OfflineScreen.tsx';
import { OnboardingScreen } from './features/onboarding/OnboardingScreen.tsx';
import { DashboardScreen } from './features/dashboard/DashboardScreen.tsx';
import { ProjectsScreen } from './features/projects/ProjectsScreen.tsx';
import { getQueryClient } from './shared/queries/client.ts';
import { useI18n } from './i18n/index.ts';

const ProjectDetailScreen = lazy(() =>
  import('./features/projects/ProjectDetailScreen.tsx').then(m => ({
    default: m.ProjectDetailScreen,
  }))
);
const PrepareDemoScreen = lazy(() =>
  import('./features/demo/PrepareDemoScreen.tsx').then(m => ({
    default: m.PrepareDemoScreen,
  }))
);
const AccountsScreen = lazy(() =>
  import('./features/accounts/AccountsScreen.tsx').then(m => ({
    default: m.AccountsScreen,
  }))
);
const QuotasScreen = lazy(() =>
  import('./features/quotas/QuotasScreen.tsx').then(m => ({
    default: m.QuotasScreen,
  }))
);
const HistoryScreen = lazy(() =>
  import('./features/history/HistoryScreen.tsx').then(m => ({
    default: m.HistoryScreen,
  }))
);
const SettingsScreen = lazy(() =>
  import('./features/settings/SettingsScreen.tsx').then(m => ({
    default: m.SettingsScreen,
  }))
);

function Shell() {
  const { pathname } = useLocation();
  const { t } = useI18n();
  const titles: Record<string, string> = {
    '/': t('common.appName'),
    '/projects': t('titles.projects'),
    '/accounts': t('titles.accounts'),
    '/quotas': t('titles.quotas'),
    '/history': t('titles.history'),
    '/settings': t('titles.settings'),
  };
  const base = `/${pathname.split('/')[1] ?? ''}`;
  const title = titles[pathname] ?? titles[base] ?? t('common.appName');

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <AppHeader title={title} />
      <main
        className="flex-1 px-3 pt-4"
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 4.25rem)',
        }}
      >
        <ErrorBoundary level="route" key={pathname}>
          <Suspense fallback={<ListSkeleton count={3} />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <BottomNav />
      <UpdatePrompt />
    </div>
  );
}

function AuthedApp() {
  const fleet = useFleetStore(s => s.fleet);
  const fromCache = useFleetStore(s => s.fromCache);
  const { isLoading, offlineEmpty, retry } = useFleetBootstrap();

  const empty = useMemo(
    () => fleet !== null && fleet.accounts.length === 0,
    [fleet]
  );

  if (offlineEmpty) {
    return <OfflineScreen onRetry={retry} />;
  }
  if (!fleet && (isLoading || !fromCache)) {
    return (
      <div className="mx-auto max-w-2xl px-3 py-6">
        <ListSkeleton count={4} />
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route
            index
            element={empty ? <OnboardingScreen /> : <DashboardScreen />}
          />
          <Route path="projects" element={<ProjectsScreen />} />
          <Route
            path="projects/:accountId/:ref"
            element={<ProjectDetailScreen />}
          />
          <Route
            path="projects/:accountId/:ref/demo"
            element={<PrepareDemoScreen />}
          />
          <Route path="accounts" element={<AccountsScreen />} />
          <Route path="quotas" element={<QuotasScreen />} />
          <Route path="history" element={<HistoryScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

function Inner() {
  const status = useSessionStore(s => s.status);
  const bootstrap = useSessionStore(s => s.bootstrap);
  const hydrateFromCache = useFleetStore(s => s.hydrateFromCache);
  const fleet = useFleetStore(s => s.fleet);
  const [bootDone, setBootDone] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);

  useEffect(() => {
    void (async () => {
      await bootstrap();
      // Session indéterminée (serveur injoignable) : tente le cache local.
      if (useSessionStore.getState().status === 'unknown') {
        await hydrateFromCache();
      }
      setBootDone(true);
    })();
  }, [bootstrap, hydrateFromCache]);

  if (!bootDone) {
    return (
      <div className="mx-auto max-w-2xl px-3 py-6">
        <ListSkeleton count={3} />
      </div>
    );
  }
  if (status === 'authenticated' || IS_MOCK) {
    // Mode local-first avec chiffrement activé : déchiffrer les PAT (saisir la
    // phrase) avant de charger la flotte.
    if (api.vault?.isEnabled() && !api.vault.isUnlocked() && !vaultUnlocked) {
      return <UnlockScreen onUnlocked={() => setVaultUnlocked(true)} />;
    }
    return <AuthedApp />;
  }
  if (status === 'unknown') {
    // Hors ligne : consultation seule du dernier état connu si disponible.
    if (fleet) return <AuthedApp />;
    return <OfflineScreen onRetry={() => window.location.reload()} />;
  }
  return <LoginScreen />;
}

export function App() {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <ErrorBoundary level="app">
        <Inner />
        <ToastViewport />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
