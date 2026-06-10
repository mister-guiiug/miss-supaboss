import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  projectMetaBodySchema,
  restoreBodySchema,
} from '../../../shared/contracts.ts';
import { requireCsrfHeader, requireRole } from '../auth.ts';
import type { AppContext } from '../context.ts';

const paramsSchema = z.object({ accountId: z.string(), ref: z.string() });
const refreshQuerySchema = z.object({ refresh: z.string().optional() });

export function registerProjectRoutes(
  app: FastifyInstance,
  ctx: AppContext
): void {
  app.get(
    '/api/fleet',
    { preHandler: requireRole(ctx, 'viewer') },
    async req => {
      const { refresh } = refreshQuerySchema.parse(req.query);
      return ctx.fleet.getFleet(refresh === '1');
    }
  );

  app.get(
    '/api/fleet/metrics',
    { preHandler: requireRole(ctx, 'viewer') },
    async req => {
      const { refresh } = refreshQuerySchema.parse(req.query);
      return ctx.fleet.getFleetMetrics(refresh === '1');
    }
  );

  app.get(
    '/api/projects/:accountId/:ref',
    { preHandler: requireRole(ctx, 'viewer') },
    async (req, reply) => {
      const { accountId, ref } = paramsSchema.parse(req.params);
      const { refresh } = refreshQuerySchema.parse(req.query);
      const fleet = await ctx.fleet.accountFleet(accountId, refresh === '1');
      const project = fleet.projects.find(p => p.ref === ref);
      if (!project) {
        return reply
          .code(404)
          .send({ error: 'not-found', message: `Projet ${ref} introuvable` });
      }
      return { project, account: fleet.account, syncedAt: fleet.syncedAt };
    }
  );

  app.get(
    '/api/projects/:accountId/:ref/restore-assessment',
    { preHandler: requireRole(ctx, 'viewer') },
    async req => {
      const { accountId, ref } = paramsSchema.parse(req.params);
      return { assessment: await ctx.fleet.assessRestore(accountId, ref) };
    }
  );

  app.put(
    '/api/projects/:accountId/:ref/meta',
    { preHandler: [requireRole(ctx, 'operator'), requireCsrfHeader] },
    async (req, reply) => {
      const { accountId, ref } = paramsSchema.parse(req.params);
      const body = projectMetaBodySchema.parse(req.body);
      const meta = ctx.store.setProjectMeta(accountId, ref, body);
      if (!meta) {
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'Projet inconnu' });
      }
      ctx.fleet.invalidate(accountId);
      const user = req.user as NonNullable<typeof req.user>;
      ctx.store.recordOperation({
        userEmail: user.email,
        action: 'project.meta',
        accountId,
        projectRef: ref,
        status: 'ok',
        detail: Object.keys(body).join(', '),
      });
      return { meta };
    }
  );

  app.post(
    '/api/projects/:accountId/:ref/pause',
    { preHandler: [requireRole(ctx, 'operator'), requireCsrfHeader] },
    async (req, reply) => {
      const { accountId, ref } = paramsSchema.parse(req.params);
      const user = req.user as NonNullable<typeof req.user>;
      const result = await ctx.fleet.pause(user.email, accountId, ref);
      return reply.code(202).send(result);
    }
  );

  app.post(
    '/api/projects/:accountId/:ref/restore',
    { preHandler: [requireRole(ctx, 'operator'), requireCsrfHeader] },
    async (req, reply) => {
      const { accountId, ref } = paramsSchema.parse(req.params);
      const body = restoreBodySchema.parse(req.body ?? {});
      const user = req.user as NonNullable<typeof req.user>;
      const result = await ctx.fleet.restore(user.email, accountId, ref, body);
      return reply.code(202).send(result);
    }
  );
}
