/**
 * Plannings d'un projet. Lire : tout utilisateur ; écrire : qui peut DÉJÀ
 * mettre en pause (operator+), puisqu'un planning est une pause différée.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { scheduleCreateBodySchema } from '../../../shared/contracts.ts';
import { requireCsrfHeader, requireRole } from '../auth.ts';
import type { AppContext } from '../context.ts';
import type { UserRow } from '../db.ts';

const projectParams = z.object({ accountId: z.string(), ref: z.string() });
const scheduleParams = projectParams.extend({ id: z.string() });

export function registerScheduleRoutes(
  app: FastifyInstance,
  ctx: AppContext
): void {
  app.get(
    '/api/projects/:accountId/:ref/schedules',
    { preHandler: requireRole(ctx, 'viewer') },
    async req => {
      const { accountId, ref } = projectParams.parse(req.params);
      return { schedules: ctx.schedules.list(accountId, ref) };
    }
  );

  app.post(
    '/api/projects/:accountId/:ref/schedules',
    { preHandler: [requireRole(ctx, 'operator'), requireCsrfHeader] },
    async (req, reply) => {
      const { accountId, ref } = projectParams.parse(req.params);
      const body = scheduleCreateBodySchema.parse(req.body);
      const schedule = ctx.schedules.create(
        req.user as UserRow,
        accountId,
        ref,
        body
      );
      return reply.code(201).send({ schedule });
    }
  );

  app.delete(
    '/api/projects/:accountId/:ref/schedules/:id',
    { preHandler: [requireRole(ctx, 'operator'), requireCsrfHeader] },
    async req => {
      const { accountId, ref, id } = scheduleParams.parse(req.params);
      ctx.schedules.remove(req.user as UserRow, accountId, ref, id);
      return { ok: true };
    }
  );
}
