/**
 * Primitives crypto du serveur — node:crypto uniquement (zéro dépendance).
 *
 * - PAT Supabase au repos : AES-256-GCM (clé maître), format `v1:iv:tag:data`.
 * - Mots de passe : scrypt + sel aléatoire, comparaison à temps constant.
 * - Sessions : token opaque aléatoire, stocké HASHÉ (SHA-256) en base.
 * - Export de configuration : AES-256-GCM avec clé dérivée d'une passphrase.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const ALGO = 'aes-256-gcm';

export function generateMasterKey(): string {
  return randomBytes(32).toString('base64');
}

function keyFromBase64(masterKey: string): Buffer {
  const key = Buffer.from(masterKey, 'base64');
  if (key.length !== 32) {
    throw new Error('SUPABOSS_MASTER_KEY doit faire 32 octets en base64');
  }
  return key;
}

export function sealSecret(plaintext: string, masterKey: string): string {
  const key = keyFromBase64(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function openSecret(blob: string, masterKey: string): string {
  const [version, ivB64, tagB64, dataB64] = blob.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Format de secret chiffré invalide');
  }
  const key = keyFromBase64(masterKey);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Indice non sensible affichable : « sbp_…a1b2 ». */
export function secretHint(secret: string): string {
  const tail = secret.slice(-4);
  const head = secret.startsWith('sbp_') ? 'sbp_' : '';
  return `${head}…${tail}`;
}

/* ── Mots de passe ────────────────────────────────────────────────────── */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split(':');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(
    password,
    Buffer.from(saltB64, 'base64'),
    expected.length
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* ── Sessions ─────────────────────────────────────────────────────────── */

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/* ── Export / import chiffré de configuration ─────────────────────────── */

export function sealWithPassphrase(
  plaintext: string,
  passphrase: string
): string {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    'supaboss-export-v1',
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    data.toString('base64'),
  ].join(':');
}

export function openWithPassphrase(blob: string, passphrase: string): string {
  const [magic, saltB64, ivB64, tagB64, dataB64] = blob.trim().split(':');
  if (
    magic !== 'supaboss-export-v1' ||
    !saltB64 ||
    !ivB64 ||
    !tagB64 ||
    !dataB64
  ) {
    throw new Error('Blob d’export invalide');
  }
  const key = scryptSync(passphrase, Buffer.from(saltB64, 'base64'), 32);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
