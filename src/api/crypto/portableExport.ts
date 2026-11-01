/**
 * Export/import chiffré des comptes pour le mode local-first (Pages).
 * Même famille crypto que le coffre (PBKDF2 + AES-256-GCM), blob portable
 * entre appareils — indépendant de la phrase du coffre local.
 */

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface PortableAccount {
  alias: string;
  color: string;
  pat: string;
  patExpiresAt: string | null;
}

interface PortablePayload {
  v: 1;
  exportedAt: string;
  accounts: PortableAccount[];
}

interface PortableEnvelope {
  v: 1;
  salt: string;
  iterations: number;
  ciphertext: string;
}

const toB64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

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

export async function sealPortableAccounts(
  accounts: PortableAccount[],
  passphrase: string
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const payload: PortablePayload = {
    v: 1,
    exportedAt: new Date().toISOString(),
    accounts,
  };
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      utf8(JSON.stringify(payload))
    )
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  const envelope: PortableEnvelope = {
    v: 1,
    salt: toB64(salt),
    iterations: PBKDF2_ITERATIONS,
    ciphertext: toB64(packed),
  };
  return `msb1.${btoa(JSON.stringify(envelope))}`;
}

export async function openPortableAccounts(
  blob: string,
  passphrase: string
): Promise<PortableAccount[]> {
  if (!blob.startsWith('msb1.')) {
    throw new Error('format');
  }
  let envelope: PortableEnvelope;
  try {
    envelope = JSON.parse(atob(blob.slice(5))) as PortableEnvelope;
  } catch {
    throw new Error('format');
  }
  if (envelope.v !== 1 || !envelope.salt || !envelope.ciphertext) {
    throw new Error('format');
  }
  const key = await deriveKey(
    passphrase,
    fromB64(envelope.salt),
    envelope.iterations
  );
  const packed = fromB64(envelope.ciphertext);
  const iv = packed.slice(0, IV_BYTES);
  const ct = packed.slice(IV_BYTES);
  let raw: string;
  try {
    raw = new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    );
  } catch {
    throw new Error('passphrase');
  }
  const payload = JSON.parse(raw) as PortablePayload;
  if (payload.v !== 1 || !Array.isArray(payload.accounts)) {
    throw new Error('format');
  }
  return payload.accounts.filter(
    a =>
      typeof a.alias === 'string' &&
      typeof a.pat === 'string' &&
      a.pat.length > 0
  );
}
