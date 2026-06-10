/**
 * « Dernier état connu » en IndexedDB : consultation hors ligne UNIQUEMENT
 * (les actions pause/restore sont désactivées sans réseau). On n'y stocke
 * que des données non sensibles : jamais de PAT (le serveur ne les expose
 * pas), jamais de session.
 */
import type { FleetDto, FleetMetricsDto } from '../../shared/contracts.ts';

const DB_NAME = 'miss-supaboss';
const STORE = 'last-known';
const KEY = 'snapshot';

export interface Snapshot {
  fleet: FleetDto;
  metrics: FleetMetricsDto | null;
  savedAt: string;
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
