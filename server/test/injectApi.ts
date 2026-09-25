/**
 * Implémentation `Api` via fastify.inject — mêmes chemins que le client HTTP.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  accountSchema,
  apiErrorSchema,
  deliveryReportSchema,
  fleetMetricsSchema,
  fleetSchema,
  loginResponseSchema,
  notificationSettingsSchema,
  operationSchema,
  projectSchema,
  restoreAssessmentSchema,
  scheduleSchema,
  settingsSchema,
  totpEnrollmentSchema,
  totpRecoveryCodesSchema,
  totpStatusSchema,
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
      'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
  const projectPath = (accountId: string, ref: string): string =>
    `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}`;
  const notificationEnvelope = z.object({
    settings: notificationSettingsSchema,
  });

  return {
    async login(email, password) {
      return injectRequest(app, '/api/auth/login', loginResponseSchema, {
        ...base,
        method: 'POST',
        body: { email, password },
        mutation: true,
      });
    },
    async loginSecondFactor(factor) {
      const { user } = await injectRequest(
        app,
        '/api/auth/login/totp',
        userEnvelope,
        { ...base, method: 'POST', body: factor, mutation: true }
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
        { ...base, method: 'PUT', body: settings, mutation: true }
      );
      return res.settings;
    },

    totp: {
      async status() {
        const { totp } = await injectRequest(
          app,
          '/api/auth/totp',
          z.object({ totp: totpStatusSchema }),
          base
        );
        return totp;
      },
      async enroll() {
        return injectRequest(
          app,
          '/api/auth/totp/enroll',
          totpEnrollmentSchema,
          {
            ...base,
            method: 'POST',
            body: {},
            mutation: true,
          }
        );
      },
      async activate(code) {
        const { recoveryCodes } = await injectRequest(
          app,
          '/api/auth/totp/activate',
          totpRecoveryCodesSchema,
          { ...base, method: 'POST', body: { code }, mutation: true }
        );
        return recoveryCodes;
      },
      async disable(password, code) {
        await injectRequest(app, '/api/auth/totp/disable', okSchema, {
          ...base,
          method: 'POST',
          body: { password, code },
          mutation: true,
        });
      },
    },

    schedules: {
      runsInBackground: true,
      async list(accountId, ref) {
        const { schedules } = await injectRequest(
          app,
          `${projectPath(accountId, ref)}/schedules`,
          z.object({ schedules: z.array(scheduleSchema) }),
          base
        );
        return schedules;
      },
      async create(accountId, ref, body) {
        const { schedule } = await injectRequest(
          app,
          `${projectPath(accountId, ref)}/schedules`,
          z.object({ schedule: scheduleSchema }),
          { ...base, method: 'POST', body, mutation: true }
        );
        return schedule;
      },
      async remove(accountId, ref, id) {
        await injectRequest(
          app,
          `${projectPath(accountId, ref)}/schedules/${encodeURIComponent(id)}`,
          okSchema,
          { ...base, method: 'DELETE', mutation: true }
        );
      },
    },

    notifications: {
      canSend: true,
      pushSubscriptionsUrl: '/api/notifications/push-subscriptions',
      async settings() {
        const { settings } = await injectRequest(
          app,
          '/api/notifications/settings',
          notificationEnvelope,
          base
        );
        return settings;
      },
      async setWebhook(url) {
        const { settings } = await injectRequest(
          app,
          '/api/notifications/webhook',
          notificationEnvelope,
          { ...base, method: 'PUT', body: { url }, mutation: true }
        );
        return settings;
      },
      async sendTest() {
        const { report } = await injectRequest(
          app,
          '/api/notifications/test',
          z.object({ report: deliveryReportSchema }),
          { ...base, method: 'POST', body: {}, mutation: true }
        );
        return report;
      },
    },
  };
}
