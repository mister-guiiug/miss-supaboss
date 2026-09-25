/**
 * Canaux de notification d'un utilisateur — Web Push et webhook — et la
 * remise d'un message sur TOUS ses canaux, avec statut consigné.
 *
 * Pas d'e-mail : il faudrait un serveur SMTP, que l'instance n'a pas.
 */
import type {
  DeliveryReportDto,
  NotificationSettingsDto,
} from '../../../shared/contracts.ts';
import { openSecret, sealSecret } from '../crypto.ts';
import type { Store, UserRow } from '../db.ts';
import { checkDestination, type HostResolver } from './destination.ts';
import {
  generateVapidKeys,
  sendWebPush,
  vapidPrivateKey,
  type VapidKeys,
} from './webpush.ts';
import { postWebhook, webhookHint } from './webhook.ts';

/** Refus à l'enregistrement d'un webhook interne : dit quoi faire. */
export const WEBHOOK_INTERNAL_REFUSAL =
  'Destinataire interne refusé : cette URL désigne le réseau du serveur (boucle locale, réseau privé, lien local, adresse réservée…). Pour un service de votre réseau local, l’administrateur peut poser SUPABOSS_WEBHOOK_ALLOW_PRIVATE=1.';

/** Refus à l'enregistrement d'un abonnement push qui vise l'interne. */
export const PUSH_INTERNAL_REFUSAL =
  'Destinataire interne refusé : un service push est toujours public.';

/** Clé de `meta` où dorment les clés VAPID, scellées par la clé maître. */
const VAPID_META_KEY = 'vapid_keys';

export interface NotificationMessage {
  event: 'quota.threshold' | 'restore.window' | 'test';
  title: string;
  body: string;
  /** Route de l'app ouverte au clic (`#/projects/…`). */
  path: string;
  /** Même étiquette : le navigateur REMPLACE la notification précédente. */
  tag: string;
  level?: string;
  project?: {
    accountId: string;
    accountAlias: string;
    ref: string;
    name: string;
  };
}

export interface NotificationServiceOptions {
  /** Contact VAPID (`mailto:` / `https:`). */
  subject: string;
  /** Injectable pour les tests : aucun appel réseau réel. */
  fetchImpl?: typeof fetch;
  /** Résolution DNS de la garde anti-SSRF ; injectable pour les tests. */
  resolver?: HostResolver;
  /** `SUPABOSS_WEBHOOK_ALLOW_PRIVATE` : webhooks vers le réseau local permis. */
  allowPrivateWebhooks?: boolean;
}

export class NotificationService {
  private readonly store: Store;
  private readonly masterKey: string;
  private readonly options: NotificationServiceOptions;
  /** `undefined` : pas encore lues ; `null` : illisibles. */
  private vapid: VapidKeys | null | undefined;

  constructor(
    store: Store,
    masterKey: string,
    options: NotificationServiceOptions
  ) {
    this.store = store;
    this.masterKey = masterKey;
    this.options = options;
  }

  /**
   * Clés VAPID du serveur : relues en base, ou engendrées et scellées au
   * PREMIER appel (le démarrage du serveur en fait un).
   *
   * ILLISIBLES — la clé maître a changé — elles ne sont PAS remplacées en
   * silence : chaque navigateur s'est abonné avec l'ancienne clé publique, et
   * de nouvelles clés rendraient tous les abonnements muets. Le push est
   * alors déclaré indisponible ; remettre la bonne clé maître le rétablit.
   */
  vapidKeys(): VapidKeys | null {
    if (this.vapid !== undefined) return this.vapid;
    const stored = this.store.getMeta(VAPID_META_KEY);
    if (!stored) {
      const keys = generateVapidKeys();
      this.store.setMeta(
        VAPID_META_KEY,
        sealSecret(JSON.stringify(keys), this.masterKey)
      );
      this.vapid = keys;
      return keys;
    }
    try {
      const keys = JSON.parse(openSecret(stored, this.masterKey)) as VapidKeys;
      vapidPrivateKey(keys);
      this.vapid = keys;
    } catch {
      this.vapid = null;
    }
    return this.vapid;
  }

  settingsFor(user: UserRow): NotificationSettingsDto {
    const keys = this.vapidKeys();
    const webhook = this.store.getWebhook(user.id);
    const last = this.store.lastOperation('alert.send', user.email);
    return {
      push: {
        available: keys !== null,
        publicKey: keys?.publicKey ?? null,
        subscriptions: this.store.listPushSubscriptions(user.id).length,
      },
      webhook: { configured: webhook !== null, hint: webhook?.hint ?? null },
      lastDelivery: last
        ? {
            at: last.ts,
            status: last.status === 'ok' ? 'ok' : 'error',
            detail: last.detail,
          }
        : null,
    };
  }

  setWebhook(user: UserRow, url: string | null): void {
    this.store.setWebhook(
      user.id,
      url === null ? null : sealSecret(url, this.masterKey),
      url === null ? null : webhookHint(url)
    );
  }

  /** Politique de la garde pour les webhooks (levable par l'environnement). */
  private webhookPolicy() {
    return {
      ...(this.options.resolver ? { resolver: this.options.resolver } : {}),
      allowPrivate: this.options.allowPrivateWebhooks === true,
    };
  }

  /**
   * Refus d'ENREGISTREMENT d'un webhook : le message à rendre, ou null.
   *
   * Refusé tout de suite si l'hôte résout vers l'interne — l'utilisateur le
   * sait au moment où il saisit, pas à la première alerte. Un nom qui ne
   * résout pas (encore) est ACCEPTÉ : la garde refait le contrôle à chaque
   * envoi, et le bouton de test dira s'il est joignable.
   */
  async webhookRefusal(url: string): Promise<string | null> {
    const verdict = await checkDestination(new URL(url), this.webhookPolicy());
    return verdict === 'internal' ? WEBHOOK_INTERNAL_REFUSAL : null;
  }

  /** Même contrôle pour le point de terminaison d'un abonnement push. */
  async pushEndpointRefusal(endpoint: string): Promise<string | null> {
    const verdict = await checkDestination(
      new URL(endpoint),
      this.options.resolver ? { resolver: this.options.resolver } : {}
    );
    return verdict === 'internal' ? PUSH_INTERNAL_REFUSAL : null;
  }

  /**
   * Remet `message` sur tous les canaux de `user`, et consigne le résultat
   * dans l'historique (`alert.send`). Ne lève pas : un canal en panne ne doit
   * ni bloquer les autres, ni la synchro qui a déclenché l'alerte.
   */
  async deliver(
    user: UserRow,
    message: NotificationMessage
  ): Promise<DeliveryReportDto> {
    const push = { sent: 0, failed: 0, removed: 0 };
    const notes: string[] = [];

    const subscriptions = this.store.listPushSubscriptions(user.id);
    if (subscriptions.length > 0) {
      const keys = this.vapidKeys();
      if (!keys) {
        push.failed = subscriptions.length;
        notes.push('push : clés VAPID illisibles (clé maître changée ?)');
      } else {
        const payload = {
          title: message.title,
          body: message.body,
          // Relatif au scope du service worker, qui le résout au clic.
          url: `./${message.path}`,
          tag: message.tag,
        };
        for (const sub of subscriptions) {
          const result = await sendWebPush(sub, payload, {
            keys,
            subject: this.options.subject,
            ...(this.options.fetchImpl
              ? { fetchImpl: this.options.fetchImpl }
              : {}),
            ...(this.options.resolver
              ? { resolver: this.options.resolver }
              : {}),
          });
          if (result.ok) {
            push.sent += 1;
            this.store.recordPushDelivery(sub.endpoint, null);
          } else if (result.gone) {
            push.removed += 1;
            this.store.forgetPushEndpoint(sub.endpoint);
          } else {
            push.failed += 1;
            this.store.recordPushDelivery(
              sub.endpoint,
              result.error ?? 'échec'
            );
          }
        }
        notes.push(pushSummary(push));
      }
    }

    let webhook: DeliveryReportDto['webhook'] = 'skipped';
    const hook = this.store.getWebhook(user.id);
    if (hook) {
      let result;
      try {
        result = await postWebhook(
          openSecret(hook.cipher, this.masterKey),
          webhookPayload(message),
          {
            ...this.webhookPolicy(),
            ...(this.options.fetchImpl
              ? { fetchImpl: this.options.fetchImpl }
              : {}),
          }
        );
      } catch {
        result = {
          ok: false,
          status: null,
          error: 'URL illisible (clé maître changée ?)',
        };
      }
      webhook = result.ok ? 'sent' : 'failed';
      notes.push(
        result.ok
          ? `webhook : HTTP ${result.status ?? '?'}`
          : `webhook : ${result.error ?? 'échec'}`
      );
    }

    if (subscriptions.length === 0 && !hook) {
      notes.push('aucun canal configuré');
    }
    const detail = notes.join(' ; ');
    const delivered = push.sent > 0 || webhook === 'sent';
    const failed = push.failed > 0 || webhook === 'failed' || !delivered;
    this.store.recordOperation({
      userEmail: user.email,
      action: 'alert.send',
      accountId: message.project?.accountId ?? null,
      accountAlias: message.project?.accountAlias ?? null,
      projectRef: message.project?.ref ?? null,
      projectName: message.project?.name ?? null,
      status: failed ? 'error' : 'ok',
      detail: `${message.title} — ${detail}`,
    });
    return { push, webhook, detail };
  }

  /** Le bouton « Envoyer une notification de test » des Réglages. */
  sendTest(user: UserRow): Promise<DeliveryReportDto> {
    return this.deliver(user, {
      event: 'test',
      title: 'Miss Supaboss — notification de test',
      body: 'Si vous lisez ceci, ce canal fonctionne.',
      path: '#/settings',
      tag: 'supaboss-test',
    });
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

function pushSummary(push: DeliveryReportDto['push']): string {
  const parts = [plural(push.sent, 'appareil atteint', 'appareils atteints')];
  if (push.failed > 0) parts.push(plural(push.failed, 'échec', 'échecs'));
  if (push.removed > 0) {
    parts.push(
      plural(
        push.removed,
        'abonnement expiré retiré',
        'abonnements expirés retirés'
      )
    );
  }
  return `push : ${parts.join(', ')}`;
}

/**
 * Corps JSON du webhook. `text` est le champ que lit un webhook entrant
 * Slack, `content` celui de Discord ; `title` et `message` servent aux
 * gabarits de ntfy (`?tpl=1&t={{.title}}&m={{.message}}`) ou d'un n8n.
 */
function webhookPayload(message: NotificationMessage) {
  const text = `${message.title} — ${message.body}`;
  return {
    source: 'miss-supaboss',
    event: message.event,
    title: message.title,
    message: message.body,
    text,
    content: text,
    path: message.path,
    ...(message.level ? { level: message.level } : {}),
    ...(message.project ? { project: message.project } : {}),
    at: new Date().toISOString(),
  };
}
