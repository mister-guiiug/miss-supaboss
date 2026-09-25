/** Configuration serveur — tout vient de l'environnement, validé au boot. */
import { z } from 'zod';

const envSchema = z.object({
  SUPABOSS_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  SUPABOSS_HOST: z.string().default('127.0.0.1'),
  SUPABOSS_DATA_DIR: z.string().default('./data'),
  /** Clé maître base64 (32 octets). Absente → générée et persistée. */
  SUPABOSS_MASTER_KEY: z.string().optional(),
  SUPABOSS_ADMIN_EMAIL: z.string().default('admin@local'),
  SUPABOSS_ADMIN_PASSWORD: z.string().optional(),
  SUPABOSS_MOCK: z.string().optional(),
  SUPABOSS_SECURE_COOKIES: z.string().optional(),
  /** Budget d'appels Management API / compte / minute (limite doc : 60). */
  SUPABOSS_API_BUDGET_PER_MIN: z.coerce
    .number()
    .int()
    .min(1)
    .max(60)
    .default(50),
  /**
   * Synchro de fond (minutes) : statuts de la flotte, puis alertes. 0 la
   * coupe — les alertes ne partent plus qu'aux synchros déclenchées par l'app.
   */
  SUPABOSS_SYNC_INTERVAL_MIN: z.coerce
    .number()
    .int()
    .min(0)
    .max(1440)
    .default(15),
  /** « 1 » : la synchro de fond collecte AUSSI les quotas (SQL sur les projets). */
  SUPABOSS_SYNC_METRICS: z.string().optional(),
  /** Contact VAPID (`mailto:` ou `https:`) transmis aux services push. */
  SUPABOSS_VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:\/\/)/, 'mailto: ou https:// attendu')
    .optional(),
  /** Secours : désactive la 2FA de cet e-mail au démarrage (téléphone perdu). */
  SUPABOSS_TOTP_RESET: z.string().optional(),
  /**
   * « 1 » : les webhooks peuvent viser le réseau interne du serveur (un ntfy
   * auto-hébergé sur le réseau local). Levée de la garde anti-SSRF : tout
   * compte pourrait alors s'en servir pour sonder ce réseau.
   */
  SUPABOSS_WEBHOOK_ALLOW_PRIVATE: z.string().optional(),
  NODE_ENV: z.string().default('development'),
});

export type Env = Readonly<{
  port: number;
  host: string;
  dataDir: string;
  masterKey: string | undefined;
  adminEmail: string;
  adminPassword: string | undefined;
  mock: boolean;
  secureCookies: boolean;
  apiBudgetPerMin: number;
  /** Minutes entre deux synchros de fond ; 0 = aucune. */
  syncIntervalMin: number;
  /** La synchro de fond collecte-t-elle aussi les quotas ? */
  syncMetrics: boolean;
  vapidSubject: string;
  /** E-mail dont la 2FA est retirée au démarrage (secours), sinon undefined. */
  totpReset: string | undefined;
  /** Webhooks vers le réseau interne permis (garde anti-SSRF levée). */
  webhookAllowPrivate: boolean;
  production: boolean;
}>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(raw);
  const adminEmail = parsed.SUPABOSS_ADMIN_EMAIL.toLowerCase();
  return {
    port: parsed.SUPABOSS_PORT,
    host: parsed.SUPABOSS_HOST,
    dataDir: parsed.SUPABOSS_DATA_DIR,
    masterKey: parsed.SUPABOSS_MASTER_KEY,
    adminEmail,
    adminPassword: parsed.SUPABOSS_ADMIN_PASSWORD,
    mock: parsed.SUPABOSS_MOCK === '1' || parsed.SUPABOSS_MOCK === 'true',
    secureCookies:
      parsed.SUPABOSS_SECURE_COOKIES === '1' ||
      parsed.SUPABOSS_SECURE_COOKIES === 'true',
    apiBudgetPerMin: parsed.SUPABOSS_API_BUDGET_PER_MIN,
    syncIntervalMin: parsed.SUPABOSS_SYNC_INTERVAL_MIN,
    syncMetrics:
      parsed.SUPABOSS_SYNC_METRICS === '1' ||
      parsed.SUPABOSS_SYNC_METRICS === 'true',
    // Apple exige un contact ; l'admin est le seul que le serveur connaisse.
    vapidSubject: parsed.SUPABOSS_VAPID_SUBJECT ?? `mailto:${adminEmail}`,
    totpReset: parsed.SUPABOSS_TOTP_RESET?.trim().toLowerCase() || undefined,
    webhookAllowPrivate:
      parsed.SUPABOSS_WEBHOOK_ALLOW_PRIVATE === '1' ||
      parsed.SUPABOSS_WEBHOOK_ALLOW_PRIVATE === 'true',
    production: parsed.NODE_ENV === 'production',
  };
}
