import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
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
import { IS_MOCK } from './api/index.ts';
import { AppHeader } from './shared/components/AppHeader.tsx';
import { BottomNav } from './shared/components/BottomNav.tsx';
import { ErrorBoundary } from './shared/components/ErrorBoundary.tsx';
import { ToastViewport } from './shared/components/ToastViewport.tsx';
import { ListSkeleton } from './shared/components/Skeleton.tsx';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';
import { LoginScreen } from './features/auth/LoginScreen.tsx';
import { OfflineScreen } from './features/offline/OfflineScreen.tsx';
import { OnboardingScreen } from './features/onboarding/OnboardingScreen.tsx';
import { DashboardScreen } from './features/dashboard/DashboardScreen.tsx';
import { ProjectsScreen } from './features/projects/ProjectsScreen.tsx';

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

const TITLES: Record<string, string> = {
  '/': 'Miss Supaboss',
  '/projects': 'Projets',
  '/accounts': 'Comptes',
  '/quotas': 'Quotas Free Plan',
  '/history': 'Historique',
  '/settings': 'Réglages',
};

function Shell() {
  const { pathname } = useLocation();
  const base = `/${pathname.split('/')[1] ?? ''}`;
  const title = TITLES[pathname] ?? TITLES[base] ?? 'Miss Supaboss';

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <AppHeader title={title} />
      <main className="flex-1 px-3 py-4">
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
  const loading = useFleetStore(s => s.loading);
  const fromCache = useFleetStore(s => s.fromCache);
  const loadFleet = useFleetStore(s => s.loadFleet);
  const loadMetrics = useFleetStore(s => s.loadMetrics);
  const loadSettings = useFleetStore(s => s.loadSettings);
  const hydrateFromCache = useFleetStore(s => s.hydrateFromCache);
  const [noData, setNoData] = useState(false);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadSettings(), loadFleet(false)]);
      const { fleet: loaded } = useFleetStore.getState();
      if (loaded) {
        void loadMetrics(false);
        return;
      }
      // Synchro impossible (hors ligne ?) → dernier état connu, sinon écran dédié.
      const hydrated = await hydrateFromCache();
      setNoData(!hydrated);
    })();
  }, [loadSettings, loadFleet, loadMetrics, hydrateFromCache]);

  const empty = useMemo(
    () => fleet !== null && fleet.accounts.length === 0,
    [fleet]
  );

  if (noData) {
    return (
      <OfflineScreen
        onRetry={() => {
          setNoData(false);
          void loadFleet(true);
        }}
      />
    );
  }
  if (!fleet && (loading || !fromCache)) {
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
  if (status === 'authenticated' || IS_MOCK) return <AuthedApp />;
  if (status === 'unknown') {
    // Hors ligne : consultation seule du dernier état connu si disponible.
    if (fleet) return <AuthedApp />;
    return <OfflineScreen onRetry={() => window.location.reload()} />;
  }
  return <LoginScreen />;
}

export function App() {
  return (
    <ErrorBoundary level="app">
      <Inner />
      <ToastViewport />
    </ErrorBoundary>
  );
}
