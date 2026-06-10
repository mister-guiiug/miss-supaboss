import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  accountCreateBodySchema,
  accountUpdateBodySchema,
  exportBodySchema,
  importBodySchema,
} from '../../../shared/contracts.ts';
import {
  openSecret,
  openWithPassphrase,
  sealSecret,
  sealWithPassphrase,
  secretHint,
} from '../crypto.ts';
import { requireCsrfHeader, requireRole } from '../auth.ts';
import type { AppContext } from '../context.ts';

const exportItemSchema = z.object({
  alias: z.string().min(1),
  color: z.string(),
  enabled: z.boolean(),
  pat: z.string().min(20),
});

export function registerAccountRoutes(
  app: FastifyInstance,
  ctx: AppContext
): void {
  const adminMutation = {
    preHandler: [requireRole(ctx, 'admin'), requireCsrfHeader],
  };

  app.get(
    '/api/accounts',
    { preHandler: requireRole(ctx, 'viewer') },
    async () => ({
      accounts: ctx.store.listAccounts().map(a => ({
        id: a.id,
        alias: a.alias,
        color: a.color,
        enabled: a.enabled,
        patHint: a.patHint,
        createdAt: a.createdAt,
        lastSyncAt: a.lastSyncAt,
        lastError: a.lastError,
      })),
    })
  );

  app.post('/api/accounts', adminMutation, async (req, reply) => {
    const body = accountCreateBodySchema.parse(req.body);
    const user = req.user as NonNullable<typeof req.user>;
    // Test de connectivité AVANT enregistrement : un PAT invalide est rejeté.
    let counts: { organizations: number; projects: number };
    try {
      counts = await ctx.fleet.testPat(`new:${user.id}`, body.pat);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.store.recordOperation({
        userEmail: user.email,
        action: 'account.create',
        status: 'error',
        detail: `Test PAT échoué : ${message}`,
      });
      return reply.code(422).send({
        error: 'pat-invalid',
        message: `Connexion Supabase impossible avec ce PAT : ${message}`,
      });
    }
    const row = ctx.store.insertAccount({
      alias: body.alias,
      color: body.color,
      patCipher: sealSecret(body.pat, ctx.masterKey),
      patHint: secretHint(body.pat),
    });
    ctx.store.recordOperation({
      userEmail: user.email,
      action: 'account.create',
      accountId: row.id,
      accountAlias: row.alias,
      status: 'ok',
      detail: `${counts.organizations} org, ${counts.projects} projets`,
    });
    return reply.code(201).send({
      account: {
        id: row.id,
        alias: row.alias,
        color: row.color,
        enabled: row.enabled,
        patHint: row.patHint,
        createdAt: row.createdAt,
        lastSyncAt: row.lastSyncAt,
        lastError: row.lastError,
      },
    });
  });

  app.patch('/api/accounts/:id', adminMutation, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = accountUpdateBodySchema.parse(req.body);
    const fields: Parameters<typeof ctx.store.updateAccount>[1] = {};
    if (body.alias !== undefined) fields.alias = body.alias;
    if (body.color !== undefined) fields.color = body.color;
    if (body.enabled !== undefined) fields.enabled = body.enabled;
    if (body.pat !== undefined) {
      fields.patCipher = sealSecret(body.pat, ctx.masterKey);
      fields.patHint = secretHint(body.pat);
    }
    const row = ctx.store.updateAccount(id, fields);
    if (!row) {
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'Compte introuvable' });
    }
    ctx.fleet.invalidate(id);
    const user = req.user as NonNullable<typeof req.user>;
    ctx.store.recordOperation({
      userEmail: user.email,
      action: 'account.update',
      accountId: id,
      accountAlias: row.alias,
      status: 'ok',
      detail: Object.keys(body).join(', '),
    });
    return {
      account: {
        id: row.id,
        alias: row.alias,
        color: row.color,
        enabled: row.enabled,
        patHint: row.patHint,
        createdAt: row.createdAt,
        lastSyncAt: row.lastSyncAt,
        lastError: row.lastError,
      },
    };
  });

  app.delete('/api/accounts/:id', adminMutation, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const row = ctx.store.getAccount(id);
    if (!row || !ctx.store.deleteAccount(id)) {
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'Compte introuvable' });
    }
    ctx.fleet.invalidate(id);
    const user = req.user as NonNullable<typeof req.user>;
    ctx.store.recordOperation({
      userEmail: user.email,
      action: 'account.delete',
      accountId: id,
      accountAlias: row.alias,
      status: 'ok',
    });
    return { ok: true };
  });

  app.post(
    '/api/accounts/:id/test',
    { preHandler: [requireRole(ctx, 'operator'), requireCsrfHeader] },
    async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const row = ctx.store.getAccount(id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'Compte introuvable' });
      }
      const user = req.user as NonNullable<typeof req.user>;
      try {
        const counts = await ctx.fleet.testPat(
          row.id,
          openSecret(row.patCipher, ctx.masterKey)
        );
        ctx.store.setAccountSync(id, true);
        ctx.store.recordOperation({
          userEmail: user.email,
          action: 'account.test',
          accountId: id,
          accountAlias: row.alias,
          status: 'ok',
          detail: `${counts.organizations} org, ${counts.projects} projets`,
        });
        return { ok: true, ...counts };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.store.setAccountSync(id, false, message);
        ctx.store.recordOperation({
          userEmail: user.email,
          action: 'account.test',
          accountId: id,
          accountAlias: row.alias,
          status: 'error',
          detail: message,
        });
        return reply.code(502).send({ error: 'test-failed', message });
      }
    }
  );

  /* ── Export / import chiffré de la configuration des comptes ─────────── */

  app.post('/api/accounts/export', adminMutation, async req => {
    const { passphrase } = exportBodySchema.parse(req.body);
    const user = req.user as NonNullable<typeof req.user>;
    const items = ctx.store.listAccounts().map(a => ({
      alias: a.alias,
      color: a.color,
      enabled: a.enabled,
      pat: openSecret(a.patCipher, ctx.masterKey),
    }));
    const blob = sealWithPassphrase(JSON.stringify(items), passphrase);
    ctx.store.recordOperation({
      userEmail: user.email,
      action: 'config.export',
      status: 'ok',
      detail: `${items.length} compte(s)`,
    });
    return { blob, count: items.length };
  });

  app.post('/api/accounts/import', adminMutation, async (req, reply) => {
    const { passphrase, blob } = importBodySchema.parse(req.body);
    const user = req.user as NonNullable<typeof req.user>;
    let items: z.infer<typeof exportItemSchema>[];
    try {
      items = z
        .array(exportItemSchema)
        .parse(JSON.parse(openWithPassphrase(blob, passphrase)));
    } catch {
      return reply.code(422).send({
        error: 'import-invalid',
        message: 'Blob illisible (passphrase incorrecte ou export corrompu)',
      });
    }
    const existingAliases = new Set(ctx.store.listAccounts().map(a => a.alias));
    let imported = 0;
    for (const item of items) {
      if (existingAliases.has(item.alias)) continue; // pas de doublon silencieux
      ctx.store.insertAccount({
        alias: item.alias,
        color: item.color,
        patCipher: sealSecret(item.pat, ctx.masterKey),
        patHint: secretHint(item.pat),
      });
      imported += 1;
    }
    ctx.store.recordOperation({
      userEmail: user.email,
      action: 'config.import',
      status: 'ok',
      detail: `${imported}/${items.length} compte(s) importé(s)`,
    });
    return { imported, total: items.length };
  });
}
