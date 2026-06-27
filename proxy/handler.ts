/**
 * Cœur du proxy CORS pour la Supabase Management API — relais minimal et SANS
 * ÉTAT, en standards Web purs (Request/Response/fetch). Aucune dépendance à un
 * runtime : utilisé par l'entrée Cloudflare Worker (`worker.ts`), testable en
 * Node, et adaptable à toute plateforme « fetch handler » (Deno Deploy,
 * Vercel/Netlify Edge, Supabase Edge Function…).
 *
 * Pourquoi : `api.supabase.com` n'autorise le CORS navigateur que depuis
 * `supabase.com`. Une PWA local-first (GitHub Pages) ne peut donc PAS appeler
 * la Management API directement. Ce relais ajoute les en-têtes CORS pour
 * l'origine de la PWA et transmet l'appel — le PAT transite dans l'en-tête
 * Authorization mais n'est NI lu NI stocké ici (relais aveugle).
 *
 * Garde-fous :
 *   - cible verrouillée sur https://api.supabase.com (jamais d'autre hôte) ;
 *   - liste blanche de chemins + méthodes (pas de relais arbitraire) ;
 *   - relais réservé aux origines de ALLOWED_ORIGINS : une requête sans en-tête
 *     Origin (curl/serveur) ou d'origine non listée est refusée (403) — empêche
 *     l'usage du Worker comme relais anonyme vers Supabase ;
 *   - fail-closed : ALLOWED_ORIGINS vide ⇒ aucune origine autorisée ;
 *   - Authorization obligatoire (401 sinon).
 */

const SUPABASE_API = 'https://api.supabase.com';

/** Chemins autorisés au relais : { méthode, motif }. `ref` = 20 lettres. */
const ALLOWED: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/v1\/organizations$/ },
  { method: 'GET', pattern: /^\/v1\/projects$/ },
  { method: 'POST', pattern: /^\/v1\/projects\/[a-z]{20}\/pause$/ },
  { method: 'POST', pattern: /^\/v1\/projects\/[a-z]{20}\/restore$/ },
  {
    method: 'POST',
    pattern: /^\/v1\/projects\/[a-z]{20}\/database\/query\/read-only$/,
  },
];

function corsHeaders(origin: string | null, allowedOrigins: string[]): Headers {
  const headers = new Headers({
    // Isolation par compte. Chaque PAT interroge la MÊME URL (?path=/v1/...) :
    // l'identité du compte ne vit QUE dans l'en-tête Authorization, qui ne fait
    // PAS partie de la clé d'un cache HTTP. Sans ces directives, un cache
    // (navigateur, CDN, cache de sous-requête Worker) pourrait resservir la
    // réponse du compte A au compte B → fuite inter-comptes (« org/projets d'un
    // autre compte »). On interdit donc tout stockage et on fait explicitement
    // varier la clé de cache sur Authorization.
    vary: 'Origin, Authorization',
    'cache-control': 'no-store',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '600',
    // Durcissement défense-en-profondeur des réponses du Worker : même si le proxy ne sert que du JSON, on bloque les
    // interprétations MIME-sniff, l'embed iframe et la fuite de referrer
    // si une réponse d'erreur venait à être rendue par un navigateur.
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  });
  const ok =
    origin !== null &&
    (allowedOrigins.includes('*') || allowedOrigins.includes(origin));
  if (ok) headers.set('access-control-allow-origin', origin);
  return headers;
}

function json(status: number, body: unknown, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Cœur du proxy (testable). `fetchImpl` injectable pour les tests.
 */
export async function handleProxy(
  request: Request,
  allowedOrigins: string[],
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin, allowedOrigins);

  // Préflight CORS.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Relais réservé aux origines navigateur autorisées. `corsHeaders` n'a posé
  // l'en-tête ACAO que si l'Origin est présent ET listé : son absence couvre
  // donc à la fois l'origine non listée ET l'appel sans Origin (curl/serveur).
  if (!cors.has('access-control-allow-origin')) {
    return json(
      403,
      { error: 'origin-forbidden', message: 'Origine non autorisée' },
      cors
    );
  }

  // Chemin cible : passé en query `?path=/v1/...` (agnostique au montage).
  const path = new URL(request.url).searchParams.get('path') ?? '';
  const allowed = ALLOWED.find(
    a => a.method === request.method && a.pattern.test(path)
  );
  if (!allowed) {
    return json(
      404,
      {
        error: 'path-not-allowed',
        message: `Relais non autorisé pour ${request.method} ${path}`,
      },
      cors
    );
  }

  const auth = request.headers.get('authorization');
  if (!auth) {
    return json(
      401,
      { error: 'missing-authorization', message: 'PAT manquant' },
      cors
    );
  }

  const upstreamInit: RequestInit = {
    method: request.method,
    headers: { authorization: auth, 'content-type': 'application/json' },
    // Jamais de cache de sous-requête (runtime Cloudflare Worker) : sa clé de
    // cache est l'URL — identique pour tous les comptes — et n'inclut PAS
    // l'Authorization. Sans 'no-store', le compte B pourrait recevoir la réponse
    // mise en cache lors de l'appel du compte A.
    cache: 'no-store',
  };
  if (request.method === 'POST') {
    upstreamInit.body = await request.text();
  }

  let upstream: Response;
  try {
    upstream = await fetchImpl(`${SUPABASE_API}${path}`, upstreamInit);
  } catch {
    return json(
      502,
      { error: 'upstream-unreachable', message: 'Supabase injoignable' },
      cors
    );
  }

  const headers = new Headers(cors);
  headers.set(
    'content-type',
    upstream.headers.get('content-type') ?? 'application/json'
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers,
  });
}

/**
 * "a,b , c" → ["a","b","c"]. Fail-closed : une valeur vide/absente donne une
 * liste vide (aucune origine autorisée) plutôt qu'un joker — un déploiement
 * sans ALLOWED_ORIGINS refuse tout au lieu d'ouvrir le relais. Pour autoriser
 * explicitement toutes les origines, mettre "*".
 */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
