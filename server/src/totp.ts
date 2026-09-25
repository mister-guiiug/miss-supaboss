/**
 * Double authentification par TOTP (RFC 6238) — node:crypto seulement.
 *
 * Paramètres FIGÉS, ceux que toutes les applications d'authentification
 * comprennent sans discussion : HMAC-SHA-1, 6 chiffres, pas de 30 s. Une
 * tolérance d'un pas de part et d'autre absorbe la dérive d'horloge d'un
 * téléphone et le temps de recopier le code.
 *
 * ANTI-REJEU (RFC 6238 §5.2) : le serveur retient le dernier pas accepté et
 * refuse tout code d'un pas inférieur ou égal. Un code intercepté (épaule,
 * enregistrement d'écran) ne rouvre donc pas une seconde session.
 */
import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Pas acceptés de part et d'autre du pas courant. */
export const TOTP_WINDOW = 1;
/** 160 bits : la taille de clé que recommande la RFC 4226 pour SHA-1. */
export const TOTP_SECRET_BYTES = 20;
export const RECOVERY_CODE_COUNT = 10;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 RFC 4648, sans remplissage — le format de l'URI otpauth://. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Tolère minuscules, espaces et remplissage ; lève sur un caractère étranger. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Secret TOTP illisible (base32)');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** HOTP (RFC 4226) : HMAC-SHA-1 du compteur, troncature dynamique. */
export function hotp(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** Pas TOTP d'un instant (ms). */
export function totpStep(timeMs: number): number {
  return Math.floor(timeMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(secret: string, timeMs: number): string {
  return hotp(base32Decode(secret), totpStep(timeMs));
}

/**
 * Cherche `code` dans la fenêtre autour de `nowMs`. Rend le PAS reconnu, ou
 * null — y compris quand ce pas a déjà servi (`lastStep`) : c'est le rejeu.
 * Toutes les comparaisons sont faites, à temps constant, même après un succès.
 */
export function matchTotp(
  secret: string,
  code: string,
  options: { nowMs: number; lastStep: number | null; window?: number }
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const current = totpStep(options.nowMs);
  const window = options.window ?? TOTP_WINDOW;
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step += 1) {
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (options.lastStep !== null && matched <= options.lastStep) return null;
  return matched;
}

/**
 * URI `otpauth://` (format Key Uri de Google Authenticator, lu par toutes
 * les applications). L'émetteur figure deux fois — dans le libellé ET en
 * paramètre — parce que les applications anciennes ne lisent que l'un des deux.
 */
export function otpauthUri(
  secret: string,
  accountName: string,
  issuer = 'Miss Supaboss'
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ── Codes de secours ─────────────────────────────────────────────────── */

/** Sans 0/O ni 1/I : un code recopié à la main ne doit pas prêter à confusion. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Dix caractères (50 bits), présentés `XXXXX-XXXXX`. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let raw = '';
    for (let j = 0; j < 10; j += 1) {
      raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/** Forme canonique hachée et comparée : majuscules, sans tiret ni espace. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}
