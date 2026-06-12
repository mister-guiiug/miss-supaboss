/**
 * Store flotte : données brutes + actions. Les sélecteurs n'exposent QUE des
 * références stables (jamais de filter/map dans un sélecteur — règle famille,
 * sinon boucle useSyncExternalStore) ; les dérivations se font en useMemo
 * côté composants ou via les helpers purs ci-dessous.
 */
import { create } from 'zustand';
import type {
  FleetDto,
  FleetMetricsDto,
  ProjectDto,
  SettingsDto,
} from '../../shared/contracts.ts';
import { DEFAULT_SETTINGS } from '../../shared/contracts.ts';
import { api, ApiError } from '../api/index.ts';
import { saveSnapshot, loadSnapshot } from '../offline/lastKnown.ts';
import { toast } from './useUiStore.ts';

interface FleetState {
  fleet: FleetDto | null;
  metrics: FleetMetricsDto | null;
  settings: SettingsDto;
  loading: boolean;
  metricsLoading: boolean;
  /** Données venues du cache hors-ligne (lecture seule). */
  fromCache: boolean;
  cacheSavedAt: string | null;
  error: string | null;

  loadFleet: (refresh?: boolean) => Promise<void>;
  loadMetrics: (refresh?: boolean) => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: SettingsDto) => Promise<void>;
  hydrateFromCache: () => Promise<boolean>;
  pause: (accountId: string, ref: string) => Promise<void>;
  restore: (
    accountId: string,
    ref: string,
    options?: { pauseFirst?: string[]; force?: boolean }
  ) => Promise<void>;
  updateMeta: (
    accountId: string,
    ref: string,
    fields: Partial<{
      tags: string[];
      favorite: boolean;
      demoFrequent: boolean;
      notes: string;
    }>
  ) => Promise<void>;
}

export const useFleetStore = create<FleetState>((set, get) => ({
  fleet: null,
  metrics: null,
  settings: DEFAULT_SETTINGS,
  loading: false,
  metricsLoading: false,
  fromCache: false,
  cacheSavedAt: null,
  error: null,

  async loadFleet(refresh = false) {
    set({ loading: true });
    try {
      const fleet = await api.getFleet(refresh);
      set({ fleet, loading: false, error: null, fromCache: false });
      void saveSnapshot({
        fleet,
        metrics: get().metrics,
        savedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Synchronisation impossible';
      set({ loading: false, error: message });
      if (!(error instanceof ApiError && error.status === 0)) {
        toast.error(message);
      }
    }
  },

  async loadMetrics(refresh = false) {
    set({ metricsLoading: true });
    try {
      const metrics = await api.getFleetMetrics(refresh);
      set({ metrics, metricsLoading: false });
      // Sur un rafraîchissement explicite, on remonte les échecs DE COLLECTE
      // (proxy/PAT) au lieu de les confondre silencieusement avec « non
      // disponible ». Un chargement de fond reste muet.
      if (refresh && metrics.refreshErrors && metrics.refreshErrors > 0) {
        toast.error(
          `Métriques indisponibles pour ${metrics.refreshErrors} projet(s) — proxy ou PAT à vérifier.`
        );
      }
      const fleet = get().fleet;
      if (fleet) {
        void saveSnapshot({
          fleet,
          metrics,
          savedAt: new Date().toISOString(),
        });
      }
    } catch {
      set({ metricsLoading: false });
      if (refresh) toast.error('Collecte des métriques impossible.');
    }
  },

  async loadSettings() {
    try {
      set({ settings: await api.getSettings() });
    } catch {
      // valeurs par défaut conservées
    }
  },

  async saveSettings(settings) {
    set({ settings: await api.putSettings(settings) });
    toast.success('Réglages enregistrés');
  },

  /** Mode hors ligne : recharge le dernier état connu (lecture seule). */
  async hydrateFromCache() {
    const snapshot = await loadSnapshot();
    if (!snapshot) return false;
    set({
      fleet: snapshot.fleet,
      metrics: snapshot.metrics,
      fromCache: true,
      cacheSavedAt: snapshot.savedAt,
    });
    return true;
  },

  async pause(accountId, ref) {
    await api.pauseProject(accountId, ref);
    toast.success('Mise en pause lancée');
    await get().loadFleet(true);
  },

  async restore(accountId, ref, options = {}) {
    await api.restoreProject(accountId, ref, {
      pauseFirst: options.pauseFirst ?? [],
      force: options.force ?? false,
    });
    toast.success('Restauration lancée');
    await get().loadFleet(true);
  },

  async updateMeta(accountId, ref, fields) {
    await api.updateProjectMeta(accountId, ref, fields);
    await get().loadFleet(false);
  },
}));

/* ── Helpers purs (à utiliser dans useMemo côté composants) ───────────── */

export function allProjects(fleet: FleetDto | null): ProjectDto[] {
  if (!fleet) return [];
  return fleet.accounts.flatMap(a => a.projects);
}

export function projectsOfAccount(
  fleet: FleetDto | null,
  accountId: string
): ProjectDto[] {
  return fleet?.accounts.find(a => a.account.id === accountId)?.projects ?? [];
}

export function findProject(
  fleet: FleetDto | null,
  accountId: string,
  ref: string
): ProjectDto | null {
  return projectsOfAccount(fleet, accountId).find(p => p.ref === ref) ?? null;
}

export function metricsOf(
  metrics: FleetMetricsDto | null,
  accountId: string,
  ref: string
) {
  return (
    metrics?.projects.find(p => p.accountId === accountId && p.ref === ref)
      ?.metrics ?? []
  );
}
