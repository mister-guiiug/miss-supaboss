/**
 * Blob localStorage du mode local-first : comptes, métadonnées, journal,
 * réglages. Les appels Management API vivent dans `localRealApi`.
 *
 * Coffre activé : le PAT clair n'est pas écrit (seul `patEnc`). Coffre
 * désactivé : le PAT reste en clair, comme avant l'opt-in.
 */
import {
  DEFAULT_SETTINGS,
  type OperationDto,
  type SettingsDto,
} from '../../shared/contracts.ts';
import {
  PREVIOUS_RESTORE_WINDOW_DAYS,
  RESTORE_WINDOW_DAYS,
} from '../../shared/guards.ts';
import type { SupabaseProjectStatus } from '../../shared/status.ts';
import { patVault } from './crypto/patVault.ts';

/** État réel persisté localement (séparé des fixtures de démo). */
export const REAL_STORAGE_KEY = 'miss-supaboss-real-v1';

export interface RealAccount {
  id: string;
  alias: string;
  color: string;
  enabled: boolean;
  /**
   * PAT en clair EN MÉMOIRE (jamais envoyé ailleurs qu'au proxy). Vide tant que
   * le coffre est verrouillé — `vault.unlock` le repeuple depuis `patEnc`.
   */
  pat: string;
  /** PAT chiffré au repos (présent uniquement si le coffre est activé). */
  patEnc?: string;
  patHint: string;
  createdAt: string;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Rappel local YYYY-MM-DD — expiration PAT saisie à la main. */
  patExpiresAt?: string | null;
}

export interface RealMeta {
  tags: string[];
  favorite: boolean;
  demoFrequent: boolean;
  notes: string;
  lastSeenActiveAt: string | null;
  pausedAt: string | null;
  lastStatus?: SupabaseProjectStatus;
  keepAliveOptIn?: boolean;
  /** Cache du dernier sondage GET /restore (évite de re-frapper à chaque sync). */
  restoreApi?: { at: number; source: 'api-ok' | 'api-blocked' };
}

/**
 * Révision du format de l'état local. Absente = 1.
 * 2 : la fenêtre de restauration passe d'une estimation de 90 jours à un an.
 */
const STATE_REVISION = 2;

export interface RealState {
  accounts: RealAccount[];
  /** Clé `${accountId}:${ref}` → métadonnées locales. */
  meta: Record<string, RealMeta>;
  operations: OperationDto[];
  settings: SettingsDto;
  opSeq: number;
  revision?: number;
}

export function emptyRealState(): RealState {
  return {
    accounts: [],
    meta: {},
    operations: [],
    settings: DEFAULT_SETTINGS,
    opSeq: 0,
    revision: STATE_REVISION,
  };
}

export function loadRealState(): RealState {
  try {
    const raw = localStorage.getItem(REAL_STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<RealState>;
      const parsed = { ...emptyRealState(), ...stored };
      // Coffre activé : le PAT en clair n'est pas persisté → `pat` absent
      // jusqu'au déverrouillage. On garantit une chaîne (jamais undefined).
      parsed.accounts = parsed.accounts.map(a => ({ ...a, pat: a.pat ?? '' }));
      // L'état entier est enregistré, réglages compris : tout appareil qui a
      // ajouté un compte a donc figé l'ancien défaut de 90 jours. Porté à un
      // an UNE fois (révision 1 → 2) ; un 90 choisi ensuite est respecté. On
      // lit la révision STOCKÉE : celle de `emptyRealState()` masquerait l'absence.
      if (
        (stored.revision ?? 1) < 2 &&
        parsed.settings.restoreWindowDays === PREVIOUS_RESTORE_WINDOW_DAYS
      )
        parsed.settings = {
          ...parsed.settings,
          restoreWindowDays: RESTORE_WINDOW_DAYS,
        };
      parsed.revision = STATE_REVISION;
      return parsed;
    }
  } catch {
    // état corrompu → repart vide
  }
  return emptyRealState();
}

export const metaKey = (accountId: string, ref: string): string =>
  `${accountId}:${ref}`;

/** Écrit l'état. Le PAT clair ne part au disque que si le coffre est éteint. */
export function saveRealState(state: RealState): void {
  try {
    const encrypted = patVault.isEnabled();
    const accounts = state.accounts.map(({ pat, patEnc, ...rest }) =>
      encrypted ? { ...rest, patEnc } : { ...rest, pat }
    );
    localStorage.setItem(
      REAL_STORAGE_KEY,
      JSON.stringify({ ...state, accounts })
    );
  } catch {
    // stockage indisponible : on continue en mémoire
  }
}
