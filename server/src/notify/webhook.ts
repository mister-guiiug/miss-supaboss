/**
 * Webhook générique : un POST JSON vers l'URL que l'utilisateur a saisie
 * (Slack, Discord, ntfy, n8n…).
 *
 * QUATRE BORNES, parce que c'est le SERVEUR qui appelle une URL venue d'un
 * utilisateur :
 *   - aucune destination interne (boucle locale, réseau privé, lien local…),
 *     contrôlée AVANT CHAQUE SAUT — `destination.ts`, et sa limite ;
 *   - https seulement — le corps décrit l'infrastructure (projets, quotas) ;
 *   - un délai d'attente par saut — un point de terminaison lent ne doit pas
 *     retenir la file des alertes ;
 *   - aucune redirection vers une AUTRE origine — une URL de confiance qui
 *     renverrait ailleurs (autre hôte, ou http) n'emmène pas le corps avec
 *     elle. Les redirections dans la même origine (barre oblique finale,
 *     réécriture de chemin) sont suivies, trois au plus.
 */
import {
  checkDestination,
  INTERNAL_DESTINATION,
  type DestinationPolicy,
} from './destination.ts';

export interface WebhookResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

export interface WebhookOptions extends DestinationPolicy {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRedirects?: number;
}

export async function postWebhook(
  url: string,
  payload: unknown,
  options: WebhookOptions = {}
): Promise<WebhookResult> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { ok: false, status: null, error: 'URL illisible' };
  }
  if (current.protocol !== 'https:') {
    return { ok: false, status: null, error: 'https requis' };
  }
  const origin = current.origin;
  const body = JSON.stringify(payload);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? 3;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // AVANT CHAQUE SAUT, redirection dans la même origine comprise : c'est le
    // même nom, mais le DNS a pu répondre autrement entre-temps.
    const verdict = await checkDestination(current, options);
    if (verdict !== 'ok') {
      return {
        ok: false,
        status: null,
        error:
          verdict === 'internal'
            ? INTERNAL_DESTINATION
            : 'destinataire injoignable',
      };
    }
    let response: Response;
    try {
      response = await fetchImpl(current.href, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'miss-supaboss',
        },
        body,
        // `manual` : c'est NOUS qui décidons de suivre, après avoir lu la cible.
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
      });
    } catch (error) {
      const timeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      return {
        ok: false,
        status: null,
        error: timeout ? 'délai dépassé' : 'destinataire injoignable',
      };
    }
    await response.arrayBuffer().catch(() => undefined);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status} sans destination`,
        };
      }
      const next = new URL(location, current);
      if (next.origin !== origin) {
        return {
          ok: false,
          status: response.status,
          error: 'redirection vers une autre origine refusée',
        };
      }
      current = next;
      continue;
    }
    return response.ok
      ? { ok: true, status: response.status, error: null }
      : {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}`,
        };
  }
  return { ok: false, status: null, error: 'trop de redirections' };
}

export { webhookHint } from '../../../shared/webhook.ts';
