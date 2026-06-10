/** Point d'entrée serveur : `node server/src/index.ts` (Node ≥ 22.18). */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.ts';
import { Store } from './db.ts';
import { FleetService } from './fleet.ts';
import { buildApp } from './app.ts';
import { generateMasterKey, hashPassword, newSessionToken } from './crypto.ts';
import { ResilientClient } from './supabase/http.ts';
import { ManagementApiProvider } from './supabase/management.ts';
import { MockProvider } from './supabase/mock.ts';
import type { AppContext } from './context.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(here, '../../package.json'), 'utf8')
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Clé maître : env > fichier persistant (généré au premier démarrage). */
function ensureMasterKey(dataDir: string, fromEnv: string | undefined): string {
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const keyPath = join(dataDir, 'master.key');
  if (existsSync(keyPath)) return readFileSync(keyPath, 'utf8').trim();
  mkdirSync(dataDir, { recursive: true });
  const key = generateMasterKey();
  writeFileSync(keyPath, key, { mode: 0o600 });
  console.warn(
    `⚠ Clé maître générée dans ${keyPath} — sauvegardez-la (ou fixez SUPABOSS_MASTER_KEY).`
  );
  return key;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const dataDir = resolve(env.dataDir);
  const masterKey = ensureMasterKey(dataDir, env.masterKey);
  const store = new Store(join(dataDir, 'supaboss.db'));

  // Premier démarrage : création de l'admin (mot de passe affiché UNE fois).
  if (store.countUsers() === 0) {
    const password = env.adminPassword ?? newSessionToken().slice(0, 16);
    store.createUser(env.adminEmail, hashPassword(password), 'admin');
    if (!env.adminPassword) {
      console.warn(
        `\n🔑 Admin créé : ${env.adminEmail}\n   Mot de passe initial : ${password}\n   (affiché une seule fois — changez-le ou fixez SUPABOSS_ADMIN_PASSWORD)\n`
      );
    } else {
      console.warn(`🔑 Admin créé : ${env.adminEmail}`);
    }
  }

  const provider = env.mock
    ? new MockProvider()
    : new ManagementApiProvider(
        new ResilientClient({ budgetPerMin: env.apiBudgetPerMin })
      );

  const ctx: AppContext = {
    env,
    store,
    fleet: new FleetService(store, provider, masterKey),
    masterKey,
    version: readVersion(),
  };

  const app = await buildApp(ctx, {
    staticDir: resolve(here, '../../dist'),
  });

  const close = async (): Promise<void> => {
    if (provider instanceof MockProvider) provider.dispose();
    await app.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());

  await app.listen({ port: env.port, host: env.host });
  app.log.info(
    `Miss Supaboss ${ctx.version} — mode ${env.mock ? 'MOCK' : 'réel'} — http://${env.host}:${env.port}`
  );
}

main().catch(error => {
  console.error('Démarrage impossible :', error);
  process.exit(1);
});
