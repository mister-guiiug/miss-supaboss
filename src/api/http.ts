/**
 * Implémentation HTTP de l'API (mode réel) : même origine que le serveur
 * Miss Supaboss, session par cookie httpOnly, en-tête anti-CSRF sur les
 * mutations, réponses VALIDÉES par les schémas zod du contrat partagé.
 */
import { z } from 'zod';
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

export function createHttpApi(): Api {
  return {
    async login(email, password) {
      const { user } = await request('/api/auth/login', userEnvelope, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
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
  };
}
