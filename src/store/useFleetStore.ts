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
import { GESTES, trackEvent } from '@mister-guiiug/dev-pwa-config/analytics';
import { loadSnapshot } from '../offline/lastKnown.ts';
import {
  fetchFleetRefresh,
  fetchMetricsRefresh,
} from '../shared/queries/fleet.ts';
import { invalidateAfterFleetMutation } from '../shared/queries/invalidate.ts';
import { translate } from '../i18n/index.ts';
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
      await fetchFleetRefresh(refresh);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : translate('fleet.syncFail');
      set({ loading: false, error: message });
      if (!(error instanceof ApiError && error.status === 0)) {
        toast.error(message);
      }
    }
  },

  async loadMetrics(refresh = false) {
    set({ metricsLoading: true });
    try {
      await fetchMetricsRefresh(refresh);
      const metrics = get().metrics;
      if (refresh && metrics?.refreshErrors && metrics.refreshErrors > 0) {
        toast.error(
          translate('fleet.metricsPartial', { count: metrics.refreshErrors })
        );
      }
    } catch {
      set({ metricsLoading: false });
      if (refresh) toast.error(translate('fleet.metricsFail'));
    }
  },

  async loadSettings() {
    try {
      const settings = await api.getSettings();
      set({ settings });
    } catch {
      // valeurs par défaut conservées
    }
  },

  async saveSettings(settings) {
    set({ settings: await api.putSettings(settings) });
    toast.success(translate('fleet.settingsSaved'));
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

  /*
   * PAUSER ET RESTAURER SONT LES DEUX GESTES QUI JUSTIFIENT CETTE APP : le
   * plan Free de Supabase ne tolère que deux projets actifs, et tout l'outil
   * existe pour arbitrer entre eux. Savoir combien d'arbitrages sont rendus
   * dit si l'app sert, là où une vue de page ne dit que « l'écran a été vu ».
   *
   * APRÈS L'APPEL, ET NON AVANT : `api.pauseProject` lève sur un refus de
   * Supabase, et la ligne suivante ne s'exécute pas. Compter avant
   * enregistrerait des pauses qui n'ont jamais eu lieu.
   *
   * NI L'IDENTIFIANT DU COMPTE, NI LA RÉFÉRENCE DU PROJET. Ce sont les
   * identifiants d'une infrastructure : ils désignent des ressources réelles,
   * et n'ont rien à faire chez un sous-traitant de mesure. Le NOMBRE de gestes
   * suffit.
   */
  async pause(accountId, ref) {
    await api.pauseProject(accountId, ref);
    trackEvent(GESTES.OPERATION, { nom: 'pause', etape: 'reussie' });
    toast.success(translate('fleet.pauseStarted'));
    await get().loadFleet(true);
    invalidateAfterFleetMutation();
  },

  async restore(accountId, ref, options = {}) {
    await api.restoreProject(accountId, ref, {
      pauseFirst: options.pauseFirst ?? [],
      force: options.force ?? false,
    });
    // `enChaine` dit si la restauration a dû mettre d'autres projets en pause
    // pour faire de la place : c'est le cas intéressant, celui où les deux
    // emplacements du plan Free étaient déjà pris.
    trackEvent(GESTES.OPERATION, {
      nom: 'restauration',
      etape: 'reussie',
      enChaine: (options.pauseFirst ?? []).length > 0,
    });
    toast.success(translate('fleet.restoreStarted'));
    await get().loadFleet(true);
    invalidateAfterFleetMutation();
  },

  async updateMeta(accountId, ref, fields) {
    await api.updateProjectMeta(accountId, ref, fields);
    await get().loadFleet(false);
    invalidateAfterFleetMutation();
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
