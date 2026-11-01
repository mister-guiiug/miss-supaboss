#!/usr/bin/env node
/**
 * Garde deploy : si VITE_SUPABASE_PROXY est non vide au build, l'URL (ou un
 * fragment stable) DOIT apparaître dans le JS produit. Évite la régression
 * #135/#153 où la var GitHub n'était plus injectée et le mode réel disparaissait
 * silencieusement (fixtures API/Web/Staging à la place des vrais projets).
 *
 * Usage :
 *   node scripts/check-proxy-in-bundle.mjs [distDir]
 * Variables :
 *   VITE_SUPABASE_PROXY — URL attendue (vide = skip OK, PWA reste en démo)
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const distDir = process.argv[2] ?? 'dist';
const proxy = (process.env.VITE_SUPABASE_PROXY ?? '').trim();

if (!proxy) {
  console.log(
    'check-proxy-in-bundle: VITE_SUPABASE_PROXY vide — skip (démo seule).'
  );
  process.exit(0);
}

let marker = proxy;
try {
  marker = new URL(proxy).hostname;
} catch {
  // URL relative / invalide : on cherche la chaîne brute
}

const assetsDir = join(distDir, 'assets');
let files;
try {
  files = await readdir(assetsDir);
} catch (e) {
  console.error(`check-proxy-in-bundle: impossible de lire ${assetsDir}`, e);
  process.exit(1);
}

const jsFiles = files.filter(f => f.endsWith('.js'));
let found = false;
for (const file of jsFiles) {
  const body = await readFile(join(assetsDir, file), 'utf8');
  if (body.includes(marker) || body.includes(proxy)) {
    found = true;
    console.log(`check-proxy-in-bundle: OK — « ${marker} » dans assets/${file}`);
    break;
  }
}

if (!found) {
  console.error(
    `check-proxy-in-bundle: ÉCHEC — VITE_SUPABASE_PROXY défini (« ${marker} ») ` +
      `mais absent du bundle ${distDir}/assets/*.js. La var n'a probablement ` +
      `pas été injectée au build (cf. deploy.yml → vars.VITE_SUPABASE_PROXY).`
  );
  process.exit(1);
}
