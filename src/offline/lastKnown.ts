/**
 * « Dernier état connu » en IndexedDB : consultation hors ligne UNIQUEMENT
 * (les actions pause/restore sont désactivées sans réseau). On n'y stocke
 * que des données non sensibles : jamais de PAT (le serveur ne les expose
 * pas), jamais de session.
 */
import type {
  AccountFleetDto,
  FleetDto,
  FleetMetricsDto,
} from '../../shared/contracts.ts';

const DB_NAME = 'miss-supaboss';
const STORE = 'last-known';
const KEY = 'snapshot';

export interface Snapshot {
  fleet: FleetDto;
  metrics: FleetMetricsDto | null;
  savedAt: string;
}

/**
 * Un compte que la synchro n'a pas pu lire : activé, et sans date de synchro
 * — c'est ainsi que le contrat le dit (`syncedAt` null si la synchro de ce
 * compte a échoué). Un compte désactivé n'est pas en échec : il est éteint.
 */
const unread = (entry: AccountFleetDto): boolean =>
  entry.account.enabled && entry.syncedAt === null;

/**
 * L'INSTANTANÉ SUIVANT, ÉCRIT PAR-DESSUS LE PRÉCÉDENT ET NON À SA PLACE.
 *
 * Un compte que la synchro n'a pas pu lire arrive SANS projet : ce n'est pas
 * son état, c'est l'absence de réponse. L'écrire tel quel effaçait, compte par
 * compte, ce que l'instantané savait encore — et c'est précisément ce qu'on
 * relit hors ligne. Ce compte garde donc ses projets, ses organisations, ses
 * métriques et la date où ils ont été lus pour la dernière fois ; seul son
 * `account` est l'actuel, puisqu'il porte l'erreur qu'on vient de voir.
 *
 * Un compte désactivé ou supprimé ne ressuscite pas : seuls les comptes
 * présents ET activés dans `next` héritent.
 */
export function mergeSnapshot(
  previous: Snapshot | null,
  next: Snapshot
): Snapshot {
  if (!previous) return next;
  const before = new Map(
    previous.fleet.accounts.map(entry => [entry.account.id, entry])
  );
  const kept = new Set<string>();
  const accounts = next.fleet.accounts.map(entry => {
    const old = before.get(entry.account.id);
    if (!old || !unread(entry)) return entry;
    kept.add(entry.account.id);
    return {
      ...entry,
      organizations: old.organizations,
      projects: old.projects,
      syncedAt: old.syncedAt,
    };
  });
  if (kept.size === 0) return next;
  return {
    ...next,
    fleet: { ...next.fleet, accounts },
    metrics: mergeMetrics(previous.metrics, next.metrics, kept),
  };
}

function mergeMetrics(
  previous: FleetMetricsDto | null,
  next: FleetMetricsDto | null,
  kept: ReadonlySet<string>
): FleetMetricsDto | null {
  const old = previous?.projects.filter(p => kept.has(p.accountId)) ?? [];
  const base = next ?? previous;
  if (old.length === 0 || !base) return next;
  return {
    ...base,
    projects: [
      ...(next?.projects.filter(p => !kept.has(p.accountId)) ?? []),
      ...old,
    ],
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error('IndexedDB indisponible'));
  });
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snapshot, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Écriture impossible'));
    });
    db.close();
  } catch {
    // hors ligne dégradé : l'absence de cache n'est jamais bloquante
  }
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    const db = await openDb();
    const snapshot = await new Promise<Snapshot | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () =>
        resolve((req.result as Snapshot | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Lecture impossible'));
    });
    db.close();
    return snapshot;
  } catch {
    return null;
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // rien à nettoyer
  }
}
