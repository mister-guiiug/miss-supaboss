/**
 * Garde anti-SSRF des requêtes que le SERVEUR émet vers une URL fournie par
 * un utilisateur : l'URL de son webhook, et le point de terminaison de ses
 * abonnements Web Push (qu'un client peut forger sans navigateur).
 *
 * POURQUOI. Sans elle, n'importe quel compte — un simple lecteur — enregistre
 * `https://169.254.169.254/…` ou `https://10.0.0.5/` puis clique « Envoyer une
 * notification de test » : le serveur appelle l'adresse et rend le statut
 * (`HTTP 404`, « destinataire injoignable »…). Il devient une sonde du réseau
 * où il tourne — métadonnées du cloud, services internes. Le https seul n'y
 * change rien : un service interne peut parler TLS.
 *
 * LA RÈGLE. L'hôte est résolu comme `fetch` le résoudra, et si UNE SEULE des
 * adresses obtenues est interne — boucle locale, non spécifiée, privée, CGNAT,
 * lien local, IPv6 unique locale, multicast, réservée, ou une IPv4 interne
 * portée par une IPv6 (mappée `::ffff:…`, NAT64, 6to4) — rien ne part. Une IP
 * littérale subit le même contrôle, sans résolution. `SUPABOSS_WEBHOOK_ALLOW_PRIVATE`
 * lève la garde pour les webhooks (ntfy auto-hébergé sur le réseau local) ;
 * jamais pour le push, dont les services sont toujours publics.
 *
 * LA LIMITE QUI RESTE : le rebinding DNS. Nous résolvons, puis `fetch` résout
 * à son tour. Entre les deux, un serveur DNS hostile à TTL nul peut répondre
 * une adresse publique à notre question et une adresse interne à celle de
 * `fetch`. Cette garde est donc une barrière de principe, PAS une garantie
 * absolue. La fermer demanderait de connecter la socket à l'adresse vérifiée
 * elle-même (`https.request` avec une option `lookup` qui refuse les adresses
 * internes), ce que `fetch` ne permet pas sans dépendance. En défense en
 * profondeur, côté hébergement : un pare-feu de sortie qui interdit au
 * conteneur le réseau interne et 169.254.169.254.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Résolution d'un nom d'hôte ; injectable pour les tests. */
export type HostResolver = (
  hostname: string
) => Promise<readonly ResolvedAddress[]>;

/**
 * La résolution du système — getaddrinfo, celle-là même que `fetch`
 * emploiera. `verbatim` : les adresses dans l'ordre du système, sans
 * réordonnancement, puisque TOUTES sont contrôlées.
 */
export const systemResolver: HostResolver = hostname =>
  lookup(hostname, { all: true, verbatim: true });

export interface DestinationPolicy {
  /** Défaut : `systemResolver`. */
  resolver?: HostResolver;
  /** Vrai : la garde est levée (réseau local de confiance). */
  allowPrivate?: boolean;
}

/** Motif rendu tel quel dans le statut de livraison. */
export const INTERNAL_DESTINATION = 'destinataire interne refusé';

/**
 * Plages IPv4 refusées : [réseau, longueur du préfixe]. Le registre IANA des
 * adresses à usage spécial, moins rien : aucune de ces plages n'héberge un
 * webhook ou un service push public.
 */
const IPV4_BLOCKED: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // « ce réseau », dont 0.0.0.0 (non spécifiée)
  ['10.0.0.0', 8], // privée
  ['100.64.0.0', 10], // CGNAT (espace partagé des opérateurs)
  ['127.0.0.0', 8], // boucle locale
  ['169.254.0.0', 16], // lien local — dont les métadonnées des clouds
  ['172.16.0.0', 12], // privée
  ['192.0.0.0', 24], // affectations de protocole IETF
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.88.99.0', 24], // relais 6to4 (obsolète)
  ['192.168.0.0', 16], // privée
  ['198.18.0.0', 15], // bancs d'essai
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // réservée, dont 255.255.255.255 (diffusion)
];

/** `a.b.c.d` strict → entier non signé (arithmétique, pas de bits signés). */
function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

const IPV4_RANGES = IPV4_BLOCKED.map(([network, prefix]) => {
  const start = ipv4ToNumber(network) ?? 0;
  return [start, start + 2 ** (32 - prefix) - 1] as const;
});

function isInternalIPv4(value: number): boolean {
  return IPV4_RANGES.some(([start, end]) => value >= start && value <= end);
}

/**
 * IPv6 → huit groupes de 16 bits. Accepte la compression `::`, une IPv4 en
 * fin d'adresse (`::ffff:1.2.3.4`) et ignore un identifiant de zone (`%eth0`).
 */
function parseIPv6(input: string): number[] | null {
  let text = input;
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const v4 = ipv4ToNumber(dotted[2] ?? '');
    if (v4 === null) return null;
    const high = Math.floor(v4 / 65_536).toString(16);
    const low = (v4 % 65_536).toString(16);
    text = `${dotted[1] ?? ''}${high}:${low}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill('0'),
    ...tail,
  ];
  if (groups.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.map(group => parseInt(group, 16));
}

function isInternalIPv6(groups: readonly number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] =
    groups;
  const embedded = (high: number, low: number): boolean =>
    isInternalIPv4(high * 65_536 + low);
  const zeroes = g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;

  // IPv4 mappée (::ffff:0:0/96) : c'est l'IPv4 que la socket joindra.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0xffff) return embedded(g6, g7);
  }
  // NAT64 bien connu (64:ff9b::/96) : la passerelle joindra cette IPv4.
  if (g0 === 0x64 && g1 === 0xff9b && zeroes) return embedded(g6, g7);
  // Hors de l'unicast global (2000::/3) : ::, ::1, IPv4 « compatible »,
  // IPv6 unique locale (fc00::/7), lien local (fe80::/10), site local,
  // multicast (ff00::/8), NAT64 local, préfixe de rejet, espace non attribué.
  if ((g0 & 0xe000) !== 0x2000) return true;
  // 6to4 (2002::/16) : l'IPv4 est portée par les bits 16 à 47.
  if (g0 === 0x2002) return embedded(g1, g2);
  // Affectations de protocole IETF (2001::/23, dont Teredo) et documentation
  // (2001:db8::/32, 3fff::/20).
  if (g0 === 0x2001 && (g1 < 0x0200 || g1 === 0x0db8)) return true;
  if (g0 === 0x3fff && g1 < 0x1000) return true;
  return false;
}

/**
 * Une adresse IP (v4 ou v6, crochets tolérés) est-elle interne ? Ce qui ne se
 * lit pas comme une IP est tenu pour interne : on ne laisse pas passer ce
 * qu'on ne sait pas classer.
 */
export function isInternalAddress(address: string): boolean {
  const text =
    address.startsWith('[') && address.endsWith(']')
      ? address.slice(1, -1)
      : address;
  const v4 = ipv4ToNumber(text);
  if (v4 !== null) return isInternalIPv4(v4);
  const v6 = parseIPv6(text);
  return v6 === null ? true : isInternalIPv6(v6);
}

export type DestinationVerdict = 'ok' | 'internal' | 'unresolved';

/**
 * Verdict pour l'hôte de `url`. `unresolved` : le nom ne résout pas — la
 * requête échouerait de toute façon, mais sans que ce soit un refus.
 */
export async function checkDestination(
  url: URL,
  policy: DestinationPolicy = {}
): Promise<DestinationVerdict> {
  if (policy.allowPrivate) return 'ok';
  // `new URL` a déjà normalisé l'hôte : `https://2130706433/`,
  // `https://0x7f.1/` et `https://127.1/` arrivent ici en `127.0.0.1`, une
  // IPv6 entre crochets et en hexadécimal (`[::ffff:7f00:1]`).
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) !== 0) return isInternalAddress(host) ? 'internal' : 'ok';
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await (policy.resolver ?? systemResolver)(host);
  } catch {
    return 'unresolved';
  }
  if (addresses.length === 0) return 'unresolved';
  return addresses.some(entry => isInternalAddress(entry.address))
    ? 'internal'
    : 'ok';
}
