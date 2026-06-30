/**
 * Implémentation `Api` via fastify.inject — mêmes chemins que le client HTTP.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  accountSchema,
  apiErrorSchema,
  fleetMetricsSchema,
  fleetSchema,
  operationSchema,
  projectSchema,
  restoreAssessmentSchema,
  settingsSchema,
  userSchema,
  type SettingsDto,
} from '../../shared/contracts.ts';
import { ApiError, type Api } from '../../src/api/types.ts';

async function injectRequest<T>(
  app: FastifyInstance,
  path: string,
  schema: z.ZodType<T>,
  init: { method?: string; body?: unknown; cookie: string; mutation?: boolean }
): Promise<T> {
  const res = await app.inject({
    method: (init.method ?? 'GET') as
      | 'GET'
      | 'POST'
      | 'PUT'
      | 'PATCH'
      | 'DELETE',
    url: path,
    headers: {
      cookie: init.cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.mutation ? { 'x-supaboss-csrf': '1' } : {}),
    },
    payload: init.body as Record<string, unknown> | undefined,
  });

  if (res.statusCode >= 400) {
    let code = 'http';
    let message = `Erreur HTTP ${res.statusCode}`;
    let assessment;
    try {
      const parsed = apiErrorSchema.parse(res.json());
      code = parsed.error;
      message = parsed.message;
      assessment = parsed.assessment;
    } catch {
      // corps non normalisé
    }
    throw new ApiError(res.statusCode, code, message, assessment);
  }

  return schema.parse(res.json());
}

const okSchema = z.object({}).loose();
const userEnvelope = z.object({ user: userSchema });
const accountEnvelope = z.object({ account: accountSchema });

export function createInjectApi(app: FastifyInstance, cookie: string): Api {
  const base = { cookie };

  return {
    async login(email, password) {
      const { user } = await injectRequest(
        app,
        '/api/auth/login',
        userEnvelope,
        {
          ...base,
          method: 'POST',
          body: { email, password },
          mutation: true,
        }
      );
      return user;
    },
    async logout() {
      await injectRequest(app, '/api/auth/logout', okSchema, {
        ...base,
        method: 'POST',
        mutation: true,
      });
    },
    async me() {
      const { user } = await injectRequest(
        app,
        '/api/auth/me',
        userEnvelope,
        base
      );
      return user;
    },

    async listAccounts() {
      const { accounts } = await injectRequest(
        app,
        '/api/accounts',
        z.object({ accounts: z.array(accountSchema) }),
        base
      );
      return accounts;
    },
    async createAccount(input) {
      const { account } = await injectRequest(
        app,
        '/api/accounts',
        accountEnvelope,
        { ...base, method: 'POST', body: input, mutation: true }
      );
      return account;
    },
    async updateAccount(id, fields) {
      const { account } = await injectRequest(
        app,
        `/api/accounts/${encodeURIComponent(id)}`,
        accountEnvelope,
        { ...base, method: 'PATCH', body: fields, mutation: true }
      );
      return account;
    },
    async deleteAccount(id) {
      await injectRequest(
        app,
        `/api/accounts/${encodeURIComponent(id)}`,
        okSchema,
        { ...base, method: 'DELETE', mutation: true }
      );
    },
    async testAccount(id) {
      return injectRequest(
        app,
        `/api/accounts/${encodeURIComponent(id)}/test`,
        z.object({
          ok: z.boolean(),
          organizations: z.array(z.string()),
          projects: z.number(),
        }),
        { ...base, method: 'POST', mutation: true }
      );
    },
    async exportAccounts(passphrase) {
      return injectRequest(
        app,
        '/api/accounts/export',
        z.object({ blob: z.string(), count: z.number() }),
        { ...base, method: 'POST', body: { passphrase }, mutation: true }
      );
    },
    async importAccounts(passphrase, blob) {
      return injectRequest(
        app,
        '/api/accounts/import',
        z.object({ imported: z.number(), total: z.number() }),
        { ...base, method: 'POST', body: { passphrase, blob }, mutation: true }
      );
    },

    async getFleet(refresh) {
      return injectRequest(
        app,
        `/api/fleet${refresh ? '?refresh=1' : ''}`,
        fleetSchema,
        base
      );
    },
    async getFleetMetrics(refresh) {
      return injectRequest(
        app,
        `/api/fleet/metrics${refresh ? '?refresh=1' : ''}`,
        fleetMetricsSchema,
        base
      );
    },
    async getProject(accountId, ref, refresh) {
      const { project } = await injectRequest(
        app,
        `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}${refresh ? '?refresh=1' : ''}`,
        z.object({ project: projectSchema }),
        base
      );
      return project;
    },
    async assessRestore(accountId, ref) {
      const { assessment } = await injectRequest(
        app,
        `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}/restore-assessment`,
        z.object({ assessment: restoreAssessmentSchema }),
        base
      );
      return assessment;
    },
    async pauseProject(accountId, ref) {
      await injectRequest(
        app,
        `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}/pause`,
        okSchema,
        { ...base, method: 'POST', body: {}, mutation: true }
      );
    },
    async restoreProject(accountId, ref, options) {
      await injectRequest(
        app,
        `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}/restore`,
        okSchema,
        { ...base, method: 'POST', body: options, mutation: true }
      );
    },
    async updateProjectMeta(accountId, ref, fields) {
      await injectRequest(
        app,
        `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}/meta`,
        okSchema,
        { ...base, method: 'PUT', body: fields, mutation: true }
      );
    },

    async listOperations(limit = 100) {
      const { operations } = await injectRequest(
        app,
        `/api/operations?limit=${limit}`,
        z.object({ operations: z.array(operationSchema) }),
        base
      );
      return operations;
    },
    async getSettings() {
      const { settings } = await injectRequest(
        app,
        '/api/me/settings',
        z.object({ settings: settingsSchema }),
        base
      );
      return settings;
    },
    async putSettings(settings: SettingsDto) {
      const res = await injectRequest(
        app,
        '/api/me/settings',
        z.object({ settings: settingsSchema }),
        { ...base, method: 'PUT', body: settings }
      );
      return res.settings;
    },
  };
}
