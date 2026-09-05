import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  HashRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import {
  Gauge,
  LayoutDashboard,
  Server,
  Settings,
  UsersRound,
  X,
} from 'lucide-react';
import { BottomNav } from '@mister-guiiug/dev-pwa-config/react/bottom-nav';
import { AppFooter } from '@mister-guiiug/dev-pwa-config/react/app-footer';
import { repoUrl } from '@mister-guiiug/dev-pwa-config/apps-catalog';
import { APP_ID } from './appId.ts';
import { ObservabilityBoundary } from '@mister-guiiug/dev-pwa-config/react/error-boundary';
import {
  IconsProvider,
  type IconComponent,
} from '@mister-guiiug/dev-pwa-config/react/icons-context';
import { useSessionStore } from './store/useSessionStore.ts';
import { useFleetStore } from './store/useFleetStore.ts';
import { api, IS_MOCK } from './api/index.ts';
import { useFleetBootstrap } from './shared/queries/fleet.ts';
import { AppHeader } from './shared/components/AppHeader.tsx';
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

// « Comptes » est une destination de 1er niveau (objet métier racine : un projet
// appartient à un compte) → 2e position, sous le pouce. L'Historique (consultatif,
// non quotidien) est relogé en tête de Réglages pour rester à 5 onglets.
const NAV_ITEMS = [
  { to: '/', labelKey: 'nav.home', Icon: LayoutDashboard, end: true },
  { to: '/accounts', labelKey: 'nav.accounts', Icon: UsersRound, end: false },
  { to: '/projects', labelKey: 'nav.projects', Icon: Server, end: false },
  { to: '/quotas', labelKey: 'nav.quotas', Icon: Gauge, end: false },
  { to: '/settings', labelKey: 'nav.settings', Icon: Settings, end: false },
] as const;

function Shell() {
  const { pathname } = useLocation();
  const { t } = useI18n();
  // `referenceLabel` existe à l'exécution (la frontière affiche l'identifiant
  // de corrélation à citer au support) mais manque encore au .d.ts 3.22.0 :
  // passé en spread, hors du contrôle des propriétés excédentaires.
  const referenceProps = { referenceLabel: t('error.reference') };
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
        <ObservabilityBoundary
          key={pathname}
          context={{ level: 'route' }}
          title={t('error.title')}
          resetLabel={t('common.retry')}
          {...referenceProps}
        >
          <Suspense fallback={<ListSkeleton count={3} />}>
            <Outlet />
          </Suspense>
        </ObservabilityBoundary>

        {/* HORS des routes : le code source et le soutien sont ainsi sur le
            premier écran comme sur les Réglages — la règle famille. Écrit dans
            un `element={…}`, ce pied de page ne vaudrait que pour une route.
            Il est DANS `<main>` à dessein : la barre basse est `fixed`, et
            c'est le padding de la coque qui lui réserve sa place. Posé après
            `</main>`, il passerait sous la barre. */}
        <AppFooter className="mt-8 justify-center" repoUrl={repoUrl(APP_ID)} />
      </main>
      <BottomNav
        // La barre reste FIXE au bas de l'écran (la coque compense par son
        // padding-bottom) ; les utilitaires l'emportent sur `@layer components`.
        className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-2xl"
        label={t('nav.aria')}
        // HashRouter : `location.pathname` du navigateur vaut toujours « / » —
        // le chemin courant doit venir du routeur.
        currentPath={pathname}
        items={NAV_ITEMS.map(({ to, labelKey, Icon, end }) => ({
          href: to,
          label: t(labelKey),
          icon: <Icon size={22} aria-hidden="true" />,
          end,
        }))}
        // Le socle 3.32.0 a élargi `linkComponent` à `ComponentType<any>` :
        // le type refusait jusque-là tout composant à prop OBLIGATOIRE, donc
        // précisément le composant de lien de react-router et son `to` —
        // l'usage que sa propre documentation donne en exemple. Cinq apps
        // portaient la même conversion ; elle n'a plus lieu d'être.
        linkComponent={NavLink}
        hrefProp="to"
      />
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

// Croix « fermer » des composants du socle (toasts) : la même que partout
// dans l'app (règle famille lucide). Cast : les icônes lucide ont des props
// toutes optionnelles, mais pas l'index signature qu'attend `IconComponent`.
const SOCLE_ICONS = { close: X as unknown as IconComponent };

export function App() {
  const { t } = useI18n();
  // Voir `Shell` : `referenceLabel` manque encore au .d.ts 3.22.0.
  const referenceProps = { referenceLabel: t('error.reference') };
  return (
    <QueryClientProvider client={getQueryClient()}>
      <IconsProvider icons={SOCLE_ICONS}>
        <ObservabilityBoundary
          context={{ level: 'app' }}
          title={t('error.title')}
          resetLabel={t('error.reload')}
          {...referenceProps}
          // Au niveau app, réessayer sans recharger relancerait le même crash :
          // on repart de zéro, comme la copie locale le faisait.
          onReset={() => window.location.reload()}
        >
          <Inner />
          <ToastViewport />
        </ObservabilityBoundary>
      </IconsProvider>
    </QueryClientProvider>
  );
}
