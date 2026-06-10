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
  production: boolean;
}>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(raw);
  return {
    port: parsed.SUPABOSS_PORT,
    host: parsed.SUPABOSS_HOST,
    dataDir: parsed.SUPABOSS_DATA_DIR,
    masterKey: parsed.SUPABOSS_MASTER_KEY,
    adminEmail: parsed.SUPABOSS_ADMIN_EMAIL.toLowerCase(),
    adminPassword: parsed.SUPABOSS_ADMIN_PASSWORD,
    mock: parsed.SUPABOSS_MOCK === '1' || parsed.SUPABOSS_MOCK === 'true',
    secureCookies:
      parsed.SUPABOSS_SECURE_COOKIES === '1' ||
      parsed.SUPABOSS_SECURE_COOKIES === 'true',
    apiBudgetPerMin: parsed.SUPABOSS_API_BUDGET_PER_MIN,
    production: parsed.NODE_ENV === 'production',
  };
}
