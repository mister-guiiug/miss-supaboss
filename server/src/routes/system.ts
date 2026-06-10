import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { settingsSchema } from '../../../shared/contracts.ts';
import { requireRole } from '../auth.ts';
import type { AppContext } from '../context.ts';

const operationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  accountId: z.string().optional(),
  ref: z.string().optional(),
});

export function registerSystemRoutes(
  app: FastifyInstance,
  ctx: AppContext
): void {
  // Public : sonde Docker / supervision (aucune donnée sensible).
  app.get('/api/system/health', async () => ({
    ok: true,
    version: ctx.version,
    mock: ctx.env.mock,
    time: new Date().toISOString(),
  }));

  app.get(
    '/api/operations',
    { preHandler: requireRole(ctx, 'viewer') },
    async req => {
      const q = operationsQuerySchema.parse(req.query);
      return {
        operations: ctx.store.listOperations(q.limit, q.accountId, q.ref),
      };
    }
  );

  app.get(
    '/api/me/settings',
    { preHandler: requireRole(ctx, 'viewer') },
    async req => {
      const user = req.user as NonNullable<typeof req.user>;
      return { settings: ctx.store.getSettings(user.id) };
    }
  );

  app.put(
    '/api/me/settings',
    { preHandler: requireRole(ctx, 'viewer') },
    async req => {
      const user = req.user as NonNullable<typeof req.user>;
      const settings = settingsSchema.parse(req.body);
      ctx.store.putSettings(user.id, settings);
      return { settings };
    }
  );
}
