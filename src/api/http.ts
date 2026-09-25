/**
 * Implémentation HTTP de l'API (mode réel) : même origine que le serveur
 * Miss Supaboss, session par cookie httpOnly, en-tête anti-CSRF sur les
 * mutations, réponses VALIDÉES par les schémas zod du contrat partagé.
 */
import { z } from 'zod';
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
import { ApiError, type Api } from './types.ts';

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {}
): Promise<T> {
  const mutation = init.method !== undefined && init.method !== 'GET';
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(mutation ? { 'x-supaboss-csrf': '1' } : {}),
      },
    });
  } catch {
    throw new ApiError(0, 'network', 'Réseau injoignable');
  }
  if (!res.ok) {
    let code = 'http';
    let message = `Erreur HTTP ${res.status}`;
    let assessment;
    try {
      const parsed = apiErrorSchema.parse(await res.json());
      code = parsed.error;
      message = parsed.message;
      assessment = parsed.assessment;
    } catch {
      // corps non normalisé : on garde le message générique
    }
    throw new ApiError(res.status, code, message, assessment);
  }
  return schema.parse(await res.json());
}

const okSchema = z.object({}).loose();
const userEnvelope = z.object({ user: userSchema });
const accountEnvelope = z.object({ account: accountSchema });
const notificationSettingsEnvelope = z.object({
  settings: notificationSettingsSchema,
});

/** `/api/projects/:acc/:ref` — les deux segments encodés. */
const projectPath = (accountId: string, ref: string): string =>
  `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}`;

export function createHttpApi(): Api {
  return {
    async login(email, password) {
      return request('/api/auth/login', loginResponseSchema, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    },
    async loginSecondFactor(factor) {
      // Le jeton d'étape voyage en cookie httpOnly : rien d'autre à joindre.
      const { user } = await request('/api/auth/login/totp', userEnvelope, {
        method: 'POST',
        body: JSON.stringify(factor),
      });
      return user;
    },
    async logout() {
      await request('/api/auth/logout', okSchema, { method: 'POST' });
    },
    async me() {
      const { user } = await request('/api/auth/me', userEnvelope);
      return user;
    },

    async listAccounts() {
      const { accounts } = await request(
        '/api/accounts',
        z.object({ accounts: z.array(accountSchema) })
      );
      return accounts;
    },
    async createAccount(input) {
      const { account } = await request('/api/accounts', accountEnvelope, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return account;
    },
    async updateAccount(id, fields) {
      const { account } = await request(
        `/api/accounts/${encodeURIComponent(id)}`,
        accountEnvelope,
        { method: 'PATCH', body: JSON.stringify(fields) }
      );
      return account;
    },
    async deleteAccount(id) {
      await request(`/api/accounts/${encodeURIComponent(id)}`, okSchema, {
        method: 'DELETE',
      });
    },
    async testAccount(id) {
      return request(
        `/api/accounts/${encodeURIComponent(id)}/test`,
        z.object({
          ok: z.boolean(),
          organizations: z.array(z.string()),
          projects: z.number(),
        }),
        { method: 'POST' }
      );
    },
    async exportAccounts(passphrase) {
      return request(
        '/api/accounts/export',
        z.object({ blob: z.string(), count: z.number() }),
        { method: 'POST', body: JSON.stringify({ passphrase }) }
      );
    },
    async importAccounts(passphrase, blob) {
      return request(
        '/api/accounts/import',
        z.object({ imported: z.number(), total: z.number() }),
        { method: 'POST', body: JSON.stringify({ passphrase, blob }) }
      );
    },

    async getFleet(refresh) {
      return request(`/api/fleet${refresh ? '?refresh=1' : ''}`, fleetSchema);
    },
    async getFleetMetrics(refresh) {
      return request(
        `/api/fleet/metrics${refresh ? '?refresh=1' : ''}`,
        fleetMetricsSchema
      );
    },
    async getProject(accountId, ref, refresh) {
      const { project } = await request(
        `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}${refresh ? '?refresh=1' : ''}`,
        z.object({ project: projectSchema })
      );
      return project;
    },
    async assessRestore(accountId, ref) {
      const { assessment } = await request(
        `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}/restore-assessment`,
        z.object({ assessment: restoreAssessmentSchema })
      );
      return assessment;
    },
    async pauseProject(accountId, ref) {
      await request(
        `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}/pause`,
        okSchema,
        { method: 'POST', body: JSON.stringify({}) }
      );
    },
    async restoreProject(accountId, ref, options) {
      await request(
        `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}/restore`,
        okSchema,
        { method: 'POST', body: JSON.stringify(options) }
      );
    },
    async updateProjectMeta(accountId, ref, fields) {
      await request(
        `/api/projects/${encodeURIComponent(accountId)}/${encodeURIComponent(ref)}/meta`,
        okSchema,
        { method: 'PUT', body: JSON.stringify(fields) }
      );
    },

    async listOperations(limit = 100) {
      const { operations } = await request(
        `/api/operations?limit=${limit}`,
        z.object({ operations: z.array(operationSchema) })
      );
      return operations;
    },
    async getSettings() {
      const { settings } = await request(
        '/api/me/settings',
        z.object({ settings: settingsSchema })
      );
      return settings;
    },
    async putSettings(settings: SettingsDto) {
      const res = await request(
        '/api/me/settings',
        z.object({ settings: settingsSchema }),
        { method: 'PUT', body: JSON.stringify(settings) }
      );
      return res.settings;
    },

    totp: {
      async status() {
        const { totp } = await request(
          '/api/auth/totp',
          z.object({ totp: totpStatusSchema })
        );
        return totp;
      },
      async enroll() {
        return request('/api/auth/totp/enroll', totpEnrollmentSchema, {
          method: 'POST',
          body: JSON.stringify({}),
        });
      },
      async activate(code) {
        const { recoveryCodes } = await request(
          '/api/auth/totp/activate',
          totpRecoveryCodesSchema,
          { method: 'POST', body: JSON.stringify({ code }) }
        );
        return recoveryCodes;
      },
      async disable(password, code) {
        await request('/api/auth/totp/disable', okSchema, {
          method: 'POST',
          body: JSON.stringify({ password, code }),
        });
      },
    },

    schedules: {
      runsInBackground: true,
      async list(accountId, ref) {
        const { schedules } = await request(
          `${projectPath(accountId, ref)}/schedules`,
          z.object({ schedules: z.array(scheduleSchema) })
        );
        return schedules;
      },
      async create(accountId, ref, body) {
        const { schedule } = await request(
          `${projectPath(accountId, ref)}/schedules`,
          z.object({ schedule: scheduleSchema }),
          { method: 'POST', body: JSON.stringify(body) }
        );
        return schedule;
      },
      async remove(accountId, ref, id) {
        await request(
          `${projectPath(accountId, ref)}/schedules/${encodeURIComponent(id)}`,
          okSchema,
          { method: 'DELETE' }
        );
      },
    },

    notifications: {
      canSend: true,
      pushSubscriptionsUrl: '/api/notifications/push-subscriptions',
      async settings() {
        const { settings } = await request(
          '/api/notifications/settings',
          notificationSettingsEnvelope
        );
        return settings;
      },
      async setWebhook(url) {
        const { settings } = await request(
          '/api/notifications/webhook',
          notificationSettingsEnvelope,
          { method: 'PUT', body: JSON.stringify({ url }) }
        );
        return settings;
      },
      async sendTest() {
        const { report } = await request(
          '/api/notifications/test',
          z.object({ report: deliveryReportSchema }),
          { method: 'POST', body: JSON.stringify({}) }
        );
        return report;
      },
    },
  };
}
