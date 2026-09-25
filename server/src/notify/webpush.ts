/**
 * Web Push SANS dépendance — node:crypto et le `fetch` de Node.
 *
 * - Identification du serveur : VAPID (RFC 8292), un JWT signé ES256 que le
 *   service push vérifie avec la clé publique donnée à l'abonnement.
 * - Chiffrement du contenu : RFC 8291 (clés du navigateur) sur RFC 8188
 *   (`aes128gcm`, un seul enregistrement). Le service push ne lit rien : il
 *   relaie un blob que seul le navigateur abonné sait ouvrir.
 *
 * Ce que ça évite : la bibliothèque `web-push` (et ses dépendances) pour
 * quatre dérivations HKDF, un ECDH et un AES-GCM que Node fournit déjà.
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import {
  checkDestination,
  INTERNAL_DESTINATION,
  type HostResolver,
} from './destination.ts';

export interface VapidKeys {
  /** Point P-256 non compressé (65 octets), base64url : l'`applicationServerKey`. */
  publicKey: string;
  /** Scalaire privé (32 octets), base64url. Scellé en base, jamais servi. */
  privateKey: string;
}

/** Ce que le navigateur a donné à l'abonnement (`PushSubscription.toJSON()`). */
export interface PushTarget {
  endpoint: string;
  /** Clé publique ECDH P-256 du navigateur (65 octets), base64url. */
  p256dh: string;
  /** Secret d'authentification (16 octets), base64url. */
  auth: string;
}

/** Taille d'enregistrement annoncée (RFC 8188) ; un seul enregistrement ici. */
const RECORD_SIZE = 4096;

/**
 * Au-delà, certains services push refusent (4 096 octets chiffrés garantis
 * par la RFC 8030, en-tête de 86 octets et étiquette de 16 compris).
 */
export const MAX_PAYLOAD_BYTES = 3_000;

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

/** Rejette une paire illisible AVANT le premier envoi, pas pendant. */
export function vapidPrivateKey(keys: VapidKeys): KeyObject {
  const pub = Buffer.from(keys.publicKey, 'base64url');
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('Clé VAPID publique invalide');
  }
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: pub.subarray(1, 33).toString('base64url'),
      y: pub.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * En-tête `Authorization` VAPID pour un point de terminaison.
 *
 * `aud` est l'ORIGINE du service push (pas l'URL complète) ; `exp` doit
 * tomber à moins de 24 h (RFC 8292 §2) — 12 h laissent de la marge à une
 * horloge serveur qui dérive. La signature ES256 est au format JWS (r‖s,
 * 64 octets), d'où `ieee-p1363` : le DER par défaut de Node serait refusé.
 */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  nowMs: number = Date.now()
): string {
  const header = base64UrlJson({ typ: 'JWT', alg: 'ES256' });
  const claims = base64UrlJson({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + 12 * 3600,
    sub: subject,
  });
  const unsigned = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: vapidPrivateKey(keys),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${keys.publicKey}`;
}

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, length: number) {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

/**
 * Chiffre un message pour UN navigateur (RFC 8291 §3.4, RFC 8188 §2).
 *
 * `fixed` n'existe que pour rejouer le vecteur de l'annexe A de la RFC 8291 :
 * en production, la clé éphémère et le sel sont neufs à chaque message — les
 * réutiliser rendrait le nonce prévisible.
 */
export function encryptPushPayload(
  payload: Uint8Array,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  fixed?: { salt: Buffer; privateKey: Buffer }
): Buffer {
  const uaPublic = Buffer.from(target.p256dh, 'base64url');
  const authSecret = Buffer.from(target.auth, 'base64url');
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error('Abonnement push : clé p256dh invalide');
  }
  if (authSecret.length !== 16) {
    throw new Error('Abonnement push : secret auth invalide');
  }

  const ecdh = createECDH('prime256v1');
  if (fixed) ecdh.setPrivateKey(fixed.privateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" ‖ 0 ‖ ua ‖ as, 32)
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'latin1'),
    uaPublic,
    asPublic,
  ]);
  const ikm = hkdf(ecdhSecret, authSecret, keyInfo, 32);

  const salt = fixed?.salt ?? randomBytes(16);
  const cek = hkdf(
    ikm,
    salt,
    Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'),
    16
  );
  const nonce = hkdf(
    ikm,
    salt,
    Buffer.from('Content-Encoding: nonce\0', 'latin1'),
    12
  );

  // Un seul enregistrement, donc le dernier : délimiteur 0x02, sans bourrage.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // En-tête RFC 8188 : sel (16) ‖ rs (4, gros-boutiste) ‖ idlen (1) ‖ keyid.
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

export interface PushSendResult {
  ok: boolean;
  /** Statut HTTP du service push, null si la requête n'a pas abouti. */
  status: number | null;
  /** 404 / 410 : l'abonnement n'existe plus, il faut l'oublier. */
  gone: boolean;
  error: string | null;
}

export interface PushSendOptions {
  keys: VapidKeys;
  subject: string;
  fetchImpl?: typeof fetch;
  /** Résolution de l'hôte du service push (garde anti-SSRF) ; injectable. */
  resolver?: HostResolver;
  timeoutMs?: number;
  /** Durée de garde chez le service push si l'appareil est éteint. */
  ttlSeconds?: number;
}

/** Envoie UN message à UN abonnement. Ne lève pas : rend un statut. */
export async function sendWebPush(
  target: PushTarget,
  message: unknown,
  options: PushSendOptions
): Promise<PushSendResult> {
  let body: Buffer;
  let authorization: string;
  try {
    const json = Buffer.from(JSON.stringify(message));
    if (json.length > MAX_PAYLOAD_BYTES) {
      return {
        ok: false,
        status: null,
        gone: false,
        error: 'message trop long',
      };
    }
    body = encryptPushPayload(json, target);
    authorization = vapidAuthorization(
      target.endpoint,
      options.keys,
      options.subject
    );
  } catch (error) {
    return {
      ok: false,
      status: null,
      gone: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Le point de terminaison vient du client, qui peut le forger sans
  // navigateur : même garde que le webhook, et elle n'est JAMAIS levée — un
  // service push est toujours public.
  const verdict = await checkDestination(
    new URL(target.endpoint),
    options.resolver ? { resolver: options.resolver } : {}
  );
  if (verdict !== 'ok') {
    return {
      ok: false,
      status: null,
      gone: false,
      error:
        verdict === 'internal'
          ? INTERNAL_DESTINATION
          : 'service push injoignable',
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(target.endpoint, {
      method: 'POST',
      headers: {
        authorization,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(options.ttlSeconds ?? 24 * 3600),
        urgency: 'normal',
      },
      body,
      // Un service push ne redirige pas ; suivre serait envoyer ailleurs.
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');
    return {
      ok: false,
      status: null,
      gone: false,
      error: timeout ? 'délai dépassé' : 'service push injoignable',
    };
  }
  // Le corps n'a pas d'intérêt ; le lire libère la connexion.
  await response.arrayBuffer().catch(() => undefined);

  if (response.status >= 200 && response.status < 300) {
    return { ok: true, status: response.status, gone: false, error: null };
  }
  const gone = response.status === 404 || response.status === 410;
  return {
    ok: false,
    status: response.status,
    gone,
    error: gone ? 'abonnement expiré' : `HTTP ${response.status}`,
  };
}
