/**
 * Coffre local pour les PAT (mode local-first, OPT-IN). Quand il est activé, les
 * jetons sont chiffrés AU REPOS (AES-256-GCM, clé dérivée d'une phrase secrète
 * par PBKDF2-SHA-256) au lieu de vivre en clair dans localStorage. La clé
 * dérivée ne réside qu'EN MÉMOIRE (jamais persistée) : il faut déverrouiller le
 * coffre — saisir la phrase — à chaque ouverture de l'application.
 *
 * Limites assumées :
 *   - protège la fuite PASSIVE (dump/backup/sync de localStorage, lecture du
 *     stockage par un script tiers, appareil perdu) ;
 *   - un XSS ACTIF pendant une session déverrouillée peut toujours appeler
 *     `decrypt` — le chiffrement au repos n'est pas une parade au XSS actif ;
 *   - phrase oubliée = PAT irrécupérables (mais régénérables côté Supabase).
 *
 * Seules les MÉTADONNÉES (sel, itérations, vérificateur) sont persistées ici ;
 * les blobs chiffrés des PAT sont stockés par `localRealApi` (avec les comptes).
 */

import {
  isPassphraseAcceptable,
  PASSPHRASE_MIN_LENGTH,
} from './passphraseStrength.ts';

const VAULT_META_KEY = 'miss-supaboss-vault-v1';
const VAULT_LOCKOUT_KEY = 'miss-supaboss-vault-lockout-v1';
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
/** Texte témoin chiffré à l'activation : son déchiffrement valide la phrase. */
const VERIFIER_PLAINTEXT = 'miss-supaboss-vault-ok';

/** Échecs avant verrouillage temporaire. */
const MAX_FAILED_UNLOCKS = 5;
/** Durée du verrouillage après trop d’échecs. */
const LOCKOUT_MS = 60_000;
/** Inactivité avant re-verrouillage automatique de la session. */
export const VAULT_IDLE_LOCK_MS = 15 * 60_000;

interface VaultMeta {
  v: 1;
  /** Sel PBKDF2 (base64). */
  salt: string;
  iterations: number;
  /** base64(iv|ct) de VERIFIER_PLAINTEXT — sert à vérifier la phrase. */
  verifier: string;
}

interface LockoutState {
  fails: number;
  lockedUntil: number;
}

/** Clé dérivée, vivante uniquement en mémoire (jamais sérialisée). */
let memoryKey: CryptoKey | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let onIdleLock: (() => void) | null = null;

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleLock(): void {
  clearIdleTimer();
  if (!memoryKey || !onIdleLock) return;
  idleTimer = setTimeout(() => {
    memoryKey = null;
    const cb = onIdleLock;
    disarmAutoLock();
    cb?.();
  }, VAULT_IDLE_LOCK_MS);
}

function disarmAutoLock(): void {
  clearIdleTimer();
  if (idleHandler) {
    window.removeEventListener('pointerdown', idleHandler, true);
    window.removeEventListener('keydown', idleHandler, true);
    idleHandler = null;
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  onIdleLock = null;
}

function recordFailedUnlock(): void {
  const cur = readLockout();
  const fails = cur.fails + 1;
  const lockedUntil = fails >= MAX_FAILED_UNLOCKS ? Date.now() + LOCKOUT_MS : 0;
  writeLockout({
    fails: fails >= MAX_FAILED_UNLOCKS ? 0 : fails,
    lockedUntil,
  });
}

const toB64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

// Depuis TS 5.7, lib.dom n'accepte plus `Uint8Array<ArrayBufferLike>` (potentiel
// SharedArrayBuffer) comme `BufferSource` : ces fabriques renvoient donc des
// vues adossées à un ArrayBuffer « pur », acceptées par crypto.subtle.
const fromB64 = (b64: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const utf8 = (s: string): Uint8Array<ArrayBuffer> => {
  const enc = new TextEncoder().encode(s);
  const out = new Uint8Array(enc.length);
  out.set(enc);
  return out;
};

function readMeta(): VaultMeta | null {
  try {
    const raw = localStorage.getItem(VAULT_META_KEY);
    return raw ? (JSON.parse(raw) as VaultMeta) : null;
  } catch {
    return null;
  }
}

function readLockout(): LockoutState {
  try {
    const raw = localStorage.getItem(VAULT_LOCKOUT_KEY);
    if (!raw) return { fails: 0, lockedUntil: 0 };
    return JSON.parse(raw) as LockoutState;
  } catch {
    return { fails: 0, lockedUntil: 0 };
  }
}

function writeLockout(state: LockoutState): void {
  try {
    localStorage.setItem(VAULT_LOCKOUT_KEY, JSON.stringify(state));
  } catch {
    /* stockage indisponible */
  }
}

function clearLockout(): void {
  try {
    localStorage.removeItem(VAULT_LOCKOUT_KEY);
  } catch {
    /* ignore */
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    utf8(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function aesEncrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(plaintext))
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return toB64(packed);
}

async function aesDecrypt(key: CryptoKey, blob: string): Promise<string> {
  const packed = fromB64(blob);
  const iv = packed.slice(0, IV_BYTES);
  const ct = packed.slice(IV_BYTES);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export const patVault = {
  minPassphraseLength: PASSPHRASE_MIN_LENGTH,

  /** Le chiffrement au repos est-il activé (métadonnées présentes) ? */
  isEnabled(): boolean {
    return readMeta() !== null;
  },

  /** La clé est-elle en mémoire (coffre déverrouillé cette session) ? */
  isUnlocked(): boolean {
    return memoryKey !== null;
  },

  /** Ms restants de verrouillage après trop d’échecs (0 = libre). */
  lockoutRemainingMs(): number {
    const { lockedUntil } = readLockout();
    return Math.max(0, lockedUntil - Date.now());
  },

  /**
   * Active le coffre avec une nouvelle phrase : génère un sel, dérive la clé
   * (gardée en mémoire) et écrit le vérificateur. L'appelant chiffre ensuite
   * les PAT existants via `encrypt`.
   */
  async enable(passphrase: string): Promise<void> {
    if (!isPassphraseAcceptable(passphrase)) {
      throw new Error('passphrase-weak');
    }
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
    const verifier = await aesEncrypt(key, VERIFIER_PLAINTEXT);
    const meta: VaultMeta = {
      v: 1,
      salt: toB64(salt),
      iterations: PBKDF2_ITERATIONS,
      verifier,
    };
    localStorage.setItem(VAULT_META_KEY, JSON.stringify(meta));
    memoryKey = key;
    clearLockout();
  },

  /**
   * Déverrouille : dérive la clé depuis la phrase et valide le vérificateur.
   * Retourne false si la phrase est incorrecte (échec d'auth GCM), sans rien
   * révéler de plus. Pendant un lockout, refuse immédiatement.
   */
  async unlock(passphrase: string): Promise<boolean> {
    if (this.lockoutRemainingMs() > 0) return false;
    const meta = readMeta();
    if (!meta) return false;
    try {
      const key = await deriveKey(
        passphrase,
        fromB64(meta.salt),
        meta.iterations
      );
      if ((await aesDecrypt(key, meta.verifier)) !== VERIFIER_PLAINTEXT) {
        recordFailedUnlock();
        return false;
      }
      memoryKey = key;
      clearLockout();
      scheduleIdleLock();
      return true;
    } catch {
      recordFailedUnlock();
      return false;
    }
  },

  /** Oublie la clé en mémoire (re-déverrouillage requis). */
  lock(): void {
    memoryKey = null;
    clearIdleTimer();
  },

  /** Désactive le chiffrement : retire les métadonnées et la clé mémoire. */
  disable(): void {
    try {
      localStorage.removeItem(VAULT_META_KEY);
    } catch {
      // stockage indisponible
    }
    clearLockout();
    memoryKey = null;
    disarmAutoLock();
  },

  /**
   * Arme le verrouillage automatique après inactivité. `onLock` est appelé
   * après oubli de la clé — l’UI doit repasser par UnlockScreen.
   */
  armAutoLock(onLock: () => void): void {
    disarmAutoLock();
    onIdleLock = onLock;
    idleHandler = () => {
      if (memoryKey) scheduleIdleLock();
    };
    window.addEventListener('pointerdown', idleHandler, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', idleHandler, {
      capture: true,
      passive: true,
    });
    visibilityHandler = () => {
      if (document.visibilityState === 'hidden' && memoryKey) {
        clearIdleTimer();
        idleTimer = setTimeout(() => {
          memoryKey = null;
          const cb = onIdleLock;
          disarmAutoLock();
          cb?.();
        }, VAULT_IDLE_LOCK_MS / 2);
      } else if (document.visibilityState === 'visible' && memoryKey) {
        scheduleIdleLock();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    scheduleIdleLock();
  },

  async encrypt(plaintext: string): Promise<string> {
    if (!memoryKey) throw new Error('vault-locked');
    return aesEncrypt(memoryKey, plaintext);
  },

  async decrypt(blob: string): Promise<string> {
    if (!memoryKey) throw new Error('vault-locked');
    return aesDecrypt(memoryKey, blob);
  },
};

export { disarmAutoLock };
