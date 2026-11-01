/**
 * Catalogue i18n découpé par domaine (shell, auth, accounts, projects, settings).
 * Régénérer les domaines : `node scripts/split-messages.mjs` (depuis un
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
