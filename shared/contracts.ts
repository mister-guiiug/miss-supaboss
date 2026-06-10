/**
 * Contrat d'API entre le front PWA et le serveur Miss Supaboss.
 * Source unique : le serveur type ses réponses avec ces types, le front
 * VALIDE les réponses avec ces schémas zod (et le mock s'y conforme).
 */
import { z } from 'zod';
import { SUPABASE_PROJECT_STATUSES } from './status.ts';

export const roleSchema = z.enum(['admin', 'operator', 'viewer']);
export type Role = z.infer<typeof roleSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: roleSchema,
});
export type UserDto = z.infer<typeof userSchema>;

export const projectStatusSchema = z.enum(SUPABASE_PROJECT_STATUSES);

export const accountSchema = z.object({
  id: z.string(),
  alias: z.string(),
  color: z.string(),
  enabled: z.boolean(),
  /** Indice non sensible du PAT : « sbp_…a1b2 ». Jamais le PAT lui-même. */
  patHint: z.string(),
  createdAt: z.string(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type AccountDto = z.infer<typeof accountSchema>;

export const projectMetaSchema = z.object({
  tags: z.array(z.string()),
  favorite: z.boolean(),
  demoFrequent: z.boolean(),
  notes: z.string(),
  /** Observations Miss Supaboss (la Management API n'expose pas l'activité). */
  lastSeenActiveAt: z.string().nullable(),
  pausedAt: z.string().nullable(),
  restoreDeadline: z.string().nullable(),
});
export type ProjectMetaDto = z.infer<typeof projectMetaSchema>;

export const projectSchema = z.object({
  accountId: z.string(),
  ref: z.string(),
  name: z.string(),
  region: z.string(),
  organizationSlug: z.string(),
  organizationName: z.string(),
  status: projectStatusSchema,
  createdAt: z.string(),
  meta: projectMetaSchema,
});
export type ProjectDto = z.infer<typeof projectSchema>;

export const organizationSchema = z.object({
  slug: z.string(),
  name: z.string(),
});
export type OrganizationDto = z.infer<typeof organizationSchema>;

export const accountFleetSchema = z.object({
  account: accountSchema,
  organizations: z.array(organizationSchema),
  projects: z.array(projectSchema),
  /** null si la synchro de ce compte a échoué (voir account.lastError). */
  syncedAt: z.string().nullable(),
});
export type AccountFleetDto = z.infer<typeof accountFleetSchema>;

export const fleetSchema = z.object({
  accounts: z.array(accountFleetSchema),
  generatedAt: z.string(),
});
export type FleetDto = z.infer<typeof fleetSchema>;

export const metricStateSchema = z.enum([
  'measured',
  'estimated',
  'stale',
  'unavailable',
]);
export const metricKindSchema = z.enum(['egress', 'dbSize', 'mau', 'storage']);

export const metricValueSchema = z.object({
  kind: metricKindSchema,
  state: metricStateSchema,
  value: z.number().nullable(),
  quota: z.number(),
  measuredAt: z.string().nullable(),
});

export const projectMetricsSchema = z.object({
  accountId: z.string(),
  ref: z.string(),
  metrics: z.array(metricValueSchema),
});
export type ProjectMetricsDto = z.infer<typeof projectMetricsSchema>;

export const fleetMetricsSchema = z.object({
  projects: z.array(projectMetricsSchema),
  generatedAt: z.string(),
});
export type FleetMetricsDto = z.infer<typeof fleetMetricsSchema>;

export const operationActionSchema = z.enum([
  'login',
  'account.create',
  'account.update',
  'account.delete',
  'account.test',
  'project.pause',
  'project.restore',
  'project.meta',
  'config.export',
  'config.import',
]);
export type OperationAction = z.infer<typeof operationActionSchema>;

export const operationSchema = z.object({
  id: z.number(),
  ts: z.string(),
  userEmail: z.string(),
  action: operationActionSchema,
  accountId: z.string().nullable(),
  accountAlias: z.string().nullable(),
  projectRef: z.string().nullable(),
  projectName: z.string().nullable(),
  status: z.enum(['ok', 'error', 'pending']),
  detail: z.string().nullable(),
});
export type OperationDto = z.infer<typeof operationSchema>;

export const restoreAssessmentSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum([
    'ok',
    'not-restorable',
    'limit-reached',
    'unknown-project',
    'already-active',
  ]),
  activeCount: z.number(),
  limit: z.number(),
  suggestions: z.array(projectSchema),
});
export type RestoreAssessmentDto = z.infer<typeof restoreAssessmentSchema>;

export const settingsSchema = z.object({
  thresholds: z.object({
    warn: z.number().min(1).max(100),
    high: z.number().min(1).max(100),
    critical: z.number().min(1).max(100),
  }),
  pollingSeconds: z.number().min(10).max(3600),
  restoreWindowDays: z.number().min(1).max(365),
});
export type SettingsDto = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: SettingsDto = {
  thresholds: { warn: 70, high: 85, critical: 95 },
  pollingSeconds: 60,
  restoreWindowDays: 90,
};

/* ── Corps de requêtes (validés par zod côté serveur ET mock) ─────────── */

export const loginBodySchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(500),
});

export const accountCreateBodySchema = z.object({
  alias: z.string().trim().min(1).max(60),
  pat: z
    .string()
    .trim()
    .min(20, 'PAT trop court')
    .max(200)
    .regex(/^sbp_/, 'Un PAT Supabase commence par sbp_'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#3ecf8e'),
});

export const accountUpdateBodySchema = z.object({
  alias: z.string().trim().min(1).max(60).optional(),
  enabled: z.boolean().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  pat: z.string().trim().min(20).max(200).regex(/^sbp_/).optional(),
});

export const projectMetaBodySchema = z.object({
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  favorite: z.boolean().optional(),
  demoFrequent: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

export const restoreBodySchema = z.object({
  /** Pauses à exécuter AVANT la restauration (workflow démo guidé). */
  pauseFirst: z.array(z.string()).max(10).default([]),
  /** Reconnaissance explicite du dépassement de limite. */
  force: z.boolean().default(false),
});

export const exportBodySchema = z.object({
  passphrase: z.string().min(8, 'Passphrase : 8 caractères minimum').max(200),
});

export const importBodySchema = z.object({
  passphrase: z.string().min(8).max(200),
  blob: z.string().min(1),
});

export const userCreateBodySchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(200),
  password: z.string().min(10, 'Mot de passe : 10 caractères minimum').max(500),
  role: roleSchema,
});

/** Erreur API normalisée. */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  assessment: restoreAssessmentSchema.optional(),
});
export type ApiErrorDto = z.infer<typeof apiErrorSchema>;
