/**
 * Proxy CORS minimal et SANS ÉTAT pour la Supabase Management API.
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
 *   - CORS restreint aux origines de ALLOWED_ORIGINS (sinon 403) ;
 *   - Authorization obligatoire (401 sinon).
 *
 * Déploiement (Supabase Edge Function) :
 *   supabase functions deploy supabase-management --no-verify-jwt
 *   supabase secrets set ALLOWED_ORIGINS="https://<user>.github.io,http://localhost:5204"
 * Côté PWA : VITE_SUPABASE_PROXY="https://<ref>.functions.supabase.co/supabase-management"
 *
 * Portable : `handleProxy` n'utilise que des standards Web (Request/Response/
 * fetch) → adaptable tel quel en Cloudflare Worker
 * (`export default { fetch: (req, env) => handleProxy(req, parseOrigins(env.ALLOWED_ORIGINS)) }`).
 */

const SUPABASE_API = 'https://api.supabase.com';

/** Chemins autorisés au relais : { méthode, motif }. `ref` = 20 lettres min. */
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
    vary: 'Origin',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '600',
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

  // Origine navigateur non autorisée → refus net.
  if (origin !== null && !cors.has('access-control-allow-origin')) {
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

/** "a,b , c" → ["a","b","c"]. Vide → ["*"] (ouvert ; restreindre en prod). */
export function parseOrigins(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : ['*'];
}

// Entrée Deno (Supabase Edge Function). Ignorée hors runtime Deno (tests Node).
declare const Deno:
  | {
      serve: (handler: (req: Request) => Response | Promise<Response>) => void;
      env: { get(key: string): string | undefined };
    }
  | undefined;

if (typeof Deno !== 'undefined' && Deno?.serve) {
  const allowedOrigins = parseOrigins(Deno.env.get('ALLOWED_ORIGINS'));
  Deno.serve((req: Request) => handleProxy(req, allowedOrigins));
}
