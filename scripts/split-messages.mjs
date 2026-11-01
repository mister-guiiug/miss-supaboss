/**
 * Découpe ponctuelle de `src/i18n/messages.ts` en domaines.
 * Usage : node scripts/split-messages.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const mod = await import('../src/i18n/messages.ts');
const { messages } = mod;

const domains = {
  shell: [
    'common',
    'languages',
    'nav',
    'titles',
    'header',
    'error',
    'guard',
    'fleet',
  ],
  auth: ['login', 'unlock', 'totp', 'authFailures', 'offline', 'onboarding'],
  accounts: ['accounts'],
  projects: [
    'projects',
    'projectCard',
    'projectDetail',
    'demo',
    'demoBanner',
    'dashboard',
    'quotas',
    'history',
  ],
  settings: ['settings', 'notify', 'schedules'],
};

mkdirSync('src/i18n/messages', { recursive: true });

function serialize(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const pad2 = '  '.repeat(indent + 1);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return (
      '[\n' +
      value.map(v => pad2 + serialize(v, indent + 1)).join(',\n') +
      '\n' +
      pad +
      ']'
    );
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  return (
    '{\n' +
    keys
      .map(k => {
        const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k);
        return pad2 + key + ': ' + serialize(value[k], indent + 1);
      })
      .join(',\n') +
    ',\n' +
    pad +
    '}'
  );
}

for (const [name, keys] of Object.entries(domains)) {
  const fr = {};
  const en = {};
  for (const k of keys) {
    if (!(k in messages.fr) || !(k in messages.en)) {
      throw new Error(`clé manquante : ${k}`);
    }
    fr[k] = messages.fr[k];
    en[k] = messages.en[k];
  }
  const body =
    `/** Domaine i18n « ${name} » — fr + en. */\n` +
    `export const ${name}Fr = ${serialize(fr)} as const;\n\n` +
    `export const ${name}En = ${serialize(en)} as const;\n`;
  writeFileSync(`src/i18n/messages/${name}.ts`, body);
}

const index = `/**
 * Catalogue i18n découpé par domaine (shell, auth, accounts, projects, settings).
 * Régénérer les domaines : \`node scripts/split-messages.mjs\` (depuis un
 * messages.ts monolithique — ou éditer les fichiers de domaine directement).
 */
import { shellFr, shellEn } from './messages/shell.ts';
import { authFr, authEn } from './messages/auth.ts';
import { accountsFr, accountsEn } from './messages/accounts.ts';
import { projectsFr, projectsEn } from './messages/projects.ts';
import { settingsFr, settingsEn } from './messages/settings.ts';

export const messages = {
  fr: { ...shellFr, ...authFr, ...accountsFr, ...projectsFr, ...settingsFr },
  en: { ...shellEn, ...authEn, ...accountsEn, ...projectsEn, ...settingsEn },
} as const;

export type Locale = keyof typeof messages;
export type Messages = (typeof messages)['fr'];
`;

writeFileSync('src/i18n/messages.ts', index);
console.log('OK — domaines :', Object.keys(domains).join(', '));
