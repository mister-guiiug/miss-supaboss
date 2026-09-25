/**
 * Contrat d'API entre le front PWA et le serveur Miss Supaboss.
 * Source unique : le serveur type ses réponses avec ces types, le front
 * VALIDE les réponses avec ces schémas zod (et le mock s'y conforme).
 */
import { z } from 'zod';
import { SUPABASE_PROJECT_STATUSES } from './status.ts';
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  isValidTimeZone,
  parseLocalDateTime,
  TIME_OF_DAY_PATTERN,
} from './schedule.ts';

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
  /**
   * Mode local-first : nombre de projets dont le rafraîchissement live a
   * vraiment ÉCHOUÉ (proxy injoignable / PAT invalide) — à distinguer d'une
   * métrique simplement « non disponible » (aucune source). Optionnel : les
   * autres backends ne le renseignent pas.
   */
  refreshErrors: z.number().int().nonnegative().optional(),
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
  /** Activation / désactivation de la double authentification. */
  'auth.totp',
  'schedule.create',
  'schedule.delete',
  /** Une alerte (ou un test) remise aux canaux : le statut de livraison. */
  'alert.send',
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

/* ── Double authentification (TOTP, RFC 6238) ─────────────────────────── */

/** Code d'application d'authentification : six chiffres, rien d'autre. */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Code à 6 chiffres');

/** Code de secours tel que saisi (tirets et espaces tolérés). */
export const recoveryCodeSchema = z.string().trim().min(8).max(40);

/**
 * Réponse du login. Avec la double authentification active, un mot de passe
 * juste NE DONNE PAS de session : il donne une étape à franchir, dont le
 * jeton voyage en cookie httpOnly (jamais lisible par le script de la page).
 */
export const loginResponseSchema = z.union([
  z.object({ user: userSchema }),
  z.object({ totpRequired: z.literal(true) }),
]);
export type LoginResponseDto = z.infer<typeof loginResponseSchema>;

/** Seconde étape : un code de l'application OU un code de secours. */
export const loginTotpBodySchema = z.union([
  z.object({ code: totpCodeSchema }),
  z.object({ recoveryCode: recoveryCodeSchema }),
]);
export type LoginTotpBody = z.infer<typeof loginTotpBodySchema>;

export const totpStatusSchema = z.object({
  enabled: z.boolean(),
  /** Un secret a été engendré mais aucun code ne l'a encore confirmé. */
  pending: z.boolean(),
  recoveryCodesLeft: z.number().int().nonnegative(),
});
export type TotpStatusDto = z.infer<typeof totpStatusSchema>;

/** Rendu UNE fois, à l'enrôlement : le secret en clair et son URI. */
export const totpEnrollmentSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
});
export type TotpEnrollmentDto = z.infer<typeof totpEnrollmentSchema>;

export const totpActivateBodySchema = z.object({ code: totpCodeSchema });

/** Les dix codes de secours, donnés une seule fois (stockés hachés). */
export const totpRecoveryCodesSchema = z.object({
  recoveryCodes: z.array(z.string()),
});

/** Désactiver exige le mot de passe ET un code (TOTP ou de secours). */
export const totpDisableBodySchema = z.object({
  password: z.string().min(1).max(500),
  code: z.string().trim().min(6).max(40),
});

/* ── Plannings (pause / restauration à heure fixe) ───────────────────── */

export const scheduleActionSchema = z.enum(['pause', 'restore']);

/**
 * Issue de la dernière exécution. `refused` : un garde-fou a dit non (limite
 * des 2 actifs, projet déjà en pause…) ; `missed` : l'échéance est passée
 * serveur arrêté ; `running` : exécution en cours (ou interrompue).
 */
export const scheduleRunStatusSchema = z.enum([
  'ok',
  'refused',
  'error',
  'missed',
  'running',
]);

const timeZoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine(isValidTimeZone, 'Fuseau horaire inconnu');

export const scheduleCreateBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('once'),
    action: scheduleActionSchema,
    /** Heure murale `YYYY-MM-DDTHH:mm` dans `timezone`. */
    at: z
      .string()
      .refine(v => parseLocalDateTime(v) !== null, 'Date-heure invalide'),
    timezone: timeZoneSchema.default(DEFAULT_SCHEDULE_TIMEZONE),
  }),
  z.object({
    kind: z.literal('weekly'),
    action: scheduleActionSchema,
    /** Jour ISO : lundi = 1 … dimanche = 7. */
    weekday: z.number().int().min(1).max(7),
    time: z.string().regex(TIME_OF_DAY_PATTERN, 'Heure invalide (HH:mm)'),
    timezone: timeZoneSchema.default(DEFAULT_SCHEDULE_TIMEZONE),
  }),
]);
/** Ce qu'envoie le client (fuseau facultatif). */
export type ScheduleCreateBody = z.input<typeof scheduleCreateBodySchema>;
/** Ce que reçoit le service une fois validé (fuseau posé). */
export type ScheduleCreateInput = z.infer<typeof scheduleCreateBodySchema>;

export const scheduleSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  ref: z.string(),
  action: scheduleActionSchema,
  kind: z.enum(['once', 'weekly']),
  at: z.string().nullable(),
  weekday: z.number().int().min(1).max(7).nullable(),
  time: z.string().nullable(),
  timezone: z.string(),
  /** Prochaine exécution (ISO UTC) ; null : ponctuel déjà joué. */
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastStatus: scheduleRunStatusSchema.nullable(),
  lastDetail: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type ScheduleDto = z.infer<typeof scheduleSchema>;

/* ── Notifications (Web Push + webhook) ──────────────────────────────── */

/**
 * URL appelée PAR LE SERVEUR : https seulement, et sans identifiants dans
 * l'URL (le `fetch` de Node les refuse, et ils finiraient dans les journaux
 * d'un proxy).
 */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(value => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' && url.username === '' && url.password === ''
      );
    } catch {
      return false;
    }
  }, 'URL https:// attendue (sans identifiants)');

const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);

/** Abonnement tel que le sérialise `serializeSubscription` du socle. */
export const pushSubscriptionSchema = z.object({
  endpoint: httpsUrlSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: base64UrlSchema.min(80).max(100),
    auth: base64UrlSchema.min(16).max(32),
  }),
});

export const pushSubscribeBodySchema = z.object({
  subscription: pushSubscriptionSchema,
});

export const pushUnsubscribeBodySchema = z.object({
  subscription: z.object({ endpoint: z.string().max(2048) }),
});

/** Remplace (URL) ou retire (null) le webhook de l'utilisateur. */
export const webhookBodySchema = z.object({
  url: httpsUrlSchema.nullable(),
});

export const notificationSettingsSchema = z.object({
  push: z.object({
    /** Clés VAPID lisibles côté serveur (sinon aucun envoi possible). */
    available: z.boolean(),
    /** Clé VAPID publique (base64url) — l'`applicationServerKey`. */
    publicKey: z.string().nullable(),
    /** Appareils abonnés pour cet utilisateur. */
    subscriptions: z.number().int().nonnegative(),
  }),
  webhook: z.object({
    configured: z.boolean(),
    /** Indice non sensible (`https://hooks.slack.com/…a1b2`) : l'URL porte souvent un secret. */
    hint: z.string().nullable(),
  }),
  /** Dernière remise (alerte ou test), telle que consignée dans l'historique. */
  lastDelivery: z
    .object({
      at: z.string(),
      status: z.enum(['ok', 'error']),
      detail: z.string().nullable(),
    })
    .nullable(),
});
export type NotificationSettingsDto = z.infer<
  typeof notificationSettingsSchema
>;

export const deliveryReportSchema = z.object({
  push: z.object({
    sent: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    /** Abonnements expirés (404/410) retirés au passage. */
    removed: z.number().int().nonnegative(),
  }),
  webhook: z.enum(['sent', 'failed', 'skipped']),
  /** Résumé lisible, le même que dans l'historique. */
  detail: z.string(),
});
export type DeliveryReportDto = z.infer<typeof deliveryReportSchema>;

/** Erreur API normalisée. */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  assessment: restoreAssessmentSchema.optional(),
});
export type ApiErrorDto = z.infer<typeof apiErrorSchema>;
