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

const VAULT_META_KEY = 'miss-supaboss-vault-v1';
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
/** Texte témoin chiffré à l'activation : son déchiffrement valide la phrase. */
const VERIFIER_PLAINTEXT = 'miss-supaboss-vault-ok';

interface VaultMeta {
  v: 1;
  /** Sel PBKDF2 (base64). */
  salt: string;
  iterations: number;
  /** base64(iv|ct) de VERIFIER_PLAINTEXT — sert à vérifier la phrase. */
  verifier: string;
}

/** Clé dérivée, vivante uniquement en mémoire (jamais sérialisée). */
let memoryKey: CryptoKey | null = null;

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
  /** Le chiffrement au repos est-il activé (métadonnées présentes) ? */
  isEnabled(): boolean {
    return readMeta() !== null;
  },

  /** La clé est-elle en mémoire (coffre déverrouillé cette session) ? */
  isUnlocked(): boolean {
    return memoryKey !== null;
  },

  /**
   * Active le coffre avec une nouvelle phrase : génère un sel, dérive la clé
   * (gardée en mémoire) et écrit le vérificateur. L'appelant chiffre ensuite
   * les PAT existants via `encrypt`.
   */
  async enable(passphrase: string): Promise<void> {
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
  },

  /**
   * Déverrouille : dérive la clé depuis la phrase et valide le vérificateur.
   * Retourne false si la phrase est incorrecte (échec d'auth GCM), sans rien
   * révéler de plus.
   */
  async unlock(passphrase: string): Promise<boolean> {
    const meta = readMeta();
    if (!meta) return false;
    try {
      const key = await deriveKey(
        passphrase,
        fromB64(meta.salt),
        meta.iterations
      );
      if ((await aesDecrypt(key, meta.verifier)) !== VERIFIER_PLAINTEXT) {
        return false;
      }
      memoryKey = key;
      return true;
    } catch {
      return false;
    }
  },

  /** Oublie la clé en mémoire (re-déverrouillage requis). */
  lock(): void {
    memoryKey = null;
  },

  /** Désactive le chiffrement : retire les métadonnées et la clé mémoire. */
  disable(): void {
    try {
      localStorage.removeItem(VAULT_META_KEY);
    } catch {
      // stockage indisponible
    }
    memoryKey = null;
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
