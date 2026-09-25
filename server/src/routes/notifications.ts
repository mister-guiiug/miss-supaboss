/**
 * Notifications de l'utilisateur connecté : ses appareils abonnés au Web
 * Push, son webhook, et l'envoi d'un test. Chacun règle SES canaux — un
 * lecteur (viewer) peut vouloir être prévenu autant qu'un admin.
 */
import type { FastifyInstance } from 'fastify';
import {
  pushSubscribeBodySchema,
  pushUnsubscribeBodySchema,
  webhookBodySchema,
} from '../../../shared/contracts.ts';
import { requireCsrfHeader, requireRole } from '../auth.ts';
import type { AppContext } from '../context.ts';
import type { UserRow } from '../db.ts';

/** Les clés d'abonnement ont une taille fixée par la RFC 8291. */
function validKeys(p256dh: string, auth: string): boolean {
  const pub = Buffer.from(p256dh, 'base64url');
  return (
    pub.length === 65 &&
    pub[0] === 0x04 &&
    Buffer.from(auth, 'base64url').length === 16
  );
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  ctx: AppContext
): void {
  const mutation = {
    preHandler: [requireRole(ctx, 'viewer'), requireCsrfHeader],
  };

  app.get(
    '/api/notifications/settings',
    { preHandler: requireRole(ctx, 'viewer') },
    async req => ({ settings: ctx.notifier.settingsFor(req.user as UserRow) })
  );

  app.put(
    '/api/notifications/webhook',
    {
      ...mutation,
      // Chaque enregistrement résout un nom venu de l'utilisateur.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const user = req.user as UserRow;
      const { url } = webhookBodySchema.parse(req.body);
      if (url !== null) {
        // Garde anti-SSRF dès l'enregistrement (et de nouveau à chaque envoi).
        const refusal = await ctx.notifier.webhookRefusal(url);
        if (refusal) {
          req.log.warn({ userId: user.id }, 'webhook interne refusé');
          return reply
            .code(400)
            .send({ error: 'internal-destination', message: refusal });
        }
      }
      ctx.notifier.setWebhook(user, url);
      return { settings: ctx.notifier.settingsFor(user) };
    }
  );

  // Les deux routes que le transport `httpPushTransport` du socle appelle.
  app.post(
    '/api/notifications/push-subscriptions',
    mutation,
    async (req, reply) => {
      const user = req.user as UserRow;
      const { subscription } = pushSubscribeBodySchema.parse(req.body);
      if (!validKeys(subscription.keys.p256dh, subscription.keys.auth)) {
        return reply.code(400).send({
          error: 'validation',
          message: 'Clés d’abonnement push invalides',
        });
      }
      // L'endpoint vient du client, qui peut le forger sans navigateur : même
      // garde anti-SSRF que le webhook (refaite à chaque envoi).
      const refusal = await ctx.notifier.pushEndpointRefusal(
        subscription.endpoint
      );
      if (refusal) {
        req.log.warn({ userId: user.id }, 'abonnement push interne refusé');
        return reply
          .code(400)
          .send({ error: 'internal-destination', message: refusal });
      }
      ctx.store.upsertPushSubscription(user.id, {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      });
      return reply.code(201).send({ settings: ctx.notifier.settingsFor(user) });
    }
  );

  app.delete('/api/notifications/push-subscriptions', mutation, async req => {
    const user = req.user as UserRow;
    const { subscription } = pushUnsubscribeBodySchema.parse(req.body);
    ctx.store.deletePushSubscription(user.id, subscription.endpoint);
    return { settings: ctx.notifier.settingsFor(user) };
  });

  app.post(
    '/api/notifications/test',
    {
      ...mutation,
      // Chaque test sort vers l'extérieur : pas de rafale.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async req => ({
      report: await ctx.notifier.sendTest(req.user as UserRow),
    })
  );
}
