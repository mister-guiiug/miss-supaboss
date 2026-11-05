import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/index.ts';
import {
  loadSnapshot,
  mergeSnapshot,
  saveSnapshot,
} from '../../offline/lastKnown.ts';
import { useFleetStore } from '../../store/useFleetStore.ts';
import { FLEET_TTL_MS, METRICS_TTL_MS } from '../../../shared/fleet/index.ts';
import { getQueryClient } from './client.ts';
import { queryKeys } from './keys.ts';

type Fleet = Awaited<ReturnType<typeof api.getFleet>>;
type FleetMetrics = Awaited<ReturnType<typeof api.getFleetMetrics>>;

/** La dernière écriture de l'instantané : les suivantes l'attendent. */
let lastKnownWrite: Promise<void> = Promise.resolve();

/**
 * Le DERNIER ÉTAT CONNU, fusionné avec le précédent (`mergeSnapshot`) : un
 * compte que la synchro n'a pas lu garde ses projets au lieu de passer à zéro.
 *
 * EN FILE, ET NON EN PARALLÈLE. Flotte et métriques arrivent presque ensemble ;
 * deux « lire, fusionner, écrire » entrelacés liraient le même précédent, et
 * le plus lent écraserait l'autre.
 */
function persistLastKnown(fleet: Fleet, metrics: FleetMetrics | null): void {
  const savedAt = new Date().toISOString();
  lastKnownWrite = lastKnownWrite
    .then(async () => {
      const previous = await loadSnapshot();
      await saveSnapshot(mergeSnapshot(previous, { fleet, metrics, savedAt }));
    })
    .catch(() => {
      // l'instantané est un bonus hors ligne : il ne bloque jamais la file
    });
}

function syncFleetToStore(fleet: Fleet): void {
  const metrics = useFleetStore.getState().metrics;
  useFleetStore.setState({
    fleet,
    fromCache: false,
    loading: false,
    error: null,
  });
  persistLastKnown(fleet, metrics);
}

function syncMetricsToStore(metrics: FleetMetrics): void {
  useFleetStore.setState({ metrics, metricsLoading: false });
  const fleet = useFleetStore.getState().fleet;
  if (fleet) persistLastKnown(fleet, metrics);
}

/** Réglages — synchronisés vers le store Zustand. */
function useSettingsQuery(enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => api.getSettings(),
    enabled,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.data) {
      useFleetStore.setState({ settings: query.data });
    }
  }, [query.data]);

  return query;
}

/** Flotte initiale (refresh=false) — source Query + miroir store. */
function useFleetQuery(enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.fleet(false),
    queryFn: () => api.getFleet(false),
    enabled,
    staleTime: FLEET_TTL_MS,
  });

  useEffect(() => {
    if (query.data) syncFleetToStore(query.data);
  }, [query.data]);

  useEffect(() => {
    useFleetStore.setState({ loading: query.isFetching && !query.data });
  }, [query.isFetching, query.data]);

  return query;
}

/** Métriques — chargées après la flotte. */
function useFleetMetricsQuery(enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.fleetMetrics(false),
    queryFn: () => api.getFleetMetrics(false),
    enabled,
    staleTime: METRICS_TTL_MS,
  });

  useEffect(() => {
    if (query.data) syncMetricsToStore(query.data);
  }, [query.data]);

  useEffect(() => {
    useFleetStore.setState({ metricsLoading: query.isFetching && !query.data });
  }, [query.isFetching, query.data]);

  return query;
}

/**
 * Bootstrap authentifié : settings + flotte + métriques via Query,
 * repli cache hors-ligne si synchro impossible.
 */
export function useFleetBootstrap() {
  const fleet = useFleetStore(s => s.fleet);
  const fromCache = useFleetStore(s => s.fromCache);
  const hydrateFromCache = useFleetStore(s => s.hydrateFromCache);
  const [offlineEmpty, setOfflineEmpty] = useState(false);
  const [hydrationDone, setHydrationDone] = useState(false);

  const settingsQ = useSettingsQuery(!offlineEmpty);
  const fleetQ = useFleetQuery(!offlineEmpty);
  const metricsQ = useFleetMetricsQuery(
    !offlineEmpty && !!fleet && !fromCache && fleetQ.isSuccess
  );

  useEffect(() => {
    if (!fleetQ.isError || fleet || fromCache || hydrationDone) return;
    void (async () => {
      const ok = await hydrateFromCache();
      setOfflineEmpty(!ok);
      setHydrationDone(true);
    })();
  }, [fleetQ.isError, fleet, fromCache, hydrationDone, hydrateFromCache]);

  const retry = useCallback(() => {
    setOfflineEmpty(false);
    setHydrationDone(false);
    void fleetQ.refetch();
  }, [fleetQ]);

  const isLoading =
    !offlineEmpty &&
    !fleet &&
    !fromCache &&
    (settingsQ.isLoading || fleetQ.isLoading);

  return { isLoading, offlineEmpty, retry, fleetQ, metricsQ };
}

/** Rafraîchissement explicite (polling, header) — bypass TTL serveur. */
export async function fetchFleetRefresh(refresh = true): Promise<void> {
  const client = getQueryClient();
  useFleetStore.setState({ loading: true });
  try {
    const fleet = await client.fetchQuery({
      queryKey: queryKeys.fleet(refresh),
      queryFn: () => api.getFleet(refresh),
      staleTime: refresh ? 0 : FLEET_TTL_MS,
    });
    client.setQueryData(queryKeys.fleet(false), fleet);
    syncFleetToStore(fleet);
  } catch (error) {
    useFleetStore.setState({ loading: false });
    throw error;
  }
}

export async function fetchMetricsRefresh(refresh = true): Promise<void> {
  const client = getQueryClient();
  useFleetStore.setState({ metricsLoading: true });
  try {
    const metrics = await client.fetchQuery({
      queryKey: queryKeys.fleetMetrics(refresh),
      queryFn: () => api.getFleetMetrics(refresh),
      staleTime: refresh ? 0 : METRICS_TTL_MS,
    });
    client.setQueryData(queryKeys.fleetMetrics(false), metrics);
    syncMetricsToStore(metrics);
  } catch {
    useFleetStore.setState({ metricsLoading: false });
    throw new Error('metrics-fetch-failed');
  }
}

/** Évaluation restore (préparation démo) — cache Query par projet. */
export function useAssessRestore(
  accountId: string,
  ref: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: queryKeys.assessRestore(accountId, ref),
    queryFn: () => api.assessRestore(accountId, ref),
    enabled: enabled && !!accountId && !!ref,
    staleTime: 0,
    retry: false,
  });
}
