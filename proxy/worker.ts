/**
 * Entrée Cloudflare Worker du proxy CORS Supabase Management.
 * La logique vit dans `handler.ts` (standards Web purs) ; ce fichier ne fait que
 * brancher l'environnement Worker. Déploiement : `wrangler deploy` (cf. README).
 */
import { handleProxy, parseOrigins } from './handler.ts';

interface Env {
  /** Origines navigateur autorisées (CSV). Définie dans wrangler.toml [vars]. */
  ALLOWED_ORIGINS?: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleProxy(request, parseOrigins(env.ALLOWED_ORIGINS));
  },
};
