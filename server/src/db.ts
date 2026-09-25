/**
 * Persistance serveur — SQLite natif (node:sqlite, Node ≥ 22.13).
 * Tout passe par `Store` : aucune requête SQL hors de ce fichier.
 *
 * Note RGPD/sécurité : la table `accounts` ne contient le PAT que chiffré
 * (AES-256-GCM, clé maître hors base) — de même le secret TOTP
 * (`user_totp`), l'URL de webhook (`notification_channels`) et les clés
 * VAPID (`meta`). Codes de secours et jetons ne sont stockés que hachés.
 * `operations` est le journal d'audit.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  MetricKind,
  MetricState,
  MetricValue,
} from '../../shared/quotas.ts';
import { FREE_PLAN_QUOTAS } from '../../shared/quotas.ts';
import { observeStatusTransition } from '../../shared/fleet/index.ts';
import type { SupabaseProjectStatus } from '../../shared/status.ts';
import type {
  OperationAction,
  OperationDto,
  Role,
  ScheduleDto,
  SettingsDto,
} from '../../shared/contracts.ts';
import { DEFAULT_SETTINGS } from '../../shared/contracts.ts';

/** Version que décrit `SCHEMA` : le socle historique, créé « si absent ». */
const BASE_SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  color TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  pat_cipher TEXT NOT NULL,
  pat_hint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS project_meta (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  demo_frequent INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_active_at TEXT,
  paused_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  PRIMARY KEY (account_id, ref)
);
CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  account_id TEXT,
  account_alias TEXT,
  project_ref TEXT,
  project_name TEXT,
  status TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_operations_ts ON operations(ts DESC);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metrics_cache (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  value REAL,
  measured_at TEXT,
  PRIMARY KEY (account_id, ref, kind)
);
`;

/**
 * Migrations de schéma, jouées UNE fois chacune, dans l'ordre, chacune dans
 * sa transaction : une base v1 existante monte sans perte, une base neuve
 * prend le même chemin (SCHEMA puis migrations). `meta.schema_version` dit où
 * en est la base. Ne jamais réécrire une migration publiée : en ajouter une.
 */
const MIGRATIONS: readonly { version: number; sql: string }[] = [
  {
    // v2 — double authentification, plannings, notifications.
    version: 2,
    sql: `
CREATE TABLE user_totp (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- secret base32 scellé AES-256-GCM (clé maître), comme les PAT
  secret_cipher TEXT NOT NULL,
  -- 0 : enrôlement en attente d'un premier code ; 1 : actif
  enabled INTEGER NOT NULL DEFAULT 0,
  -- dernier pas TOTP accepté : tout code d'un pas <= est un rejeu
  last_step INTEGER,
  created_at TEXT NOT NULL,
  enabled_at TEXT
);
CREATE TABLE totp_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_recovery_user ON totp_recovery_codes(user_id);
CREATE TABLE login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  action TEXT NOT NULL,
  kind TEXT NOT NULL,
  at_local TEXT,
  weekday INTEGER,
  time_local TEXT,
  timezone TEXT NOT NULL,
  -- ISO UTC ; avancée AVANT l'exécution (claim) : un redémarrage ne rejoue rien
  next_run_at TEXT,
  last_run_at TEXT,
  last_status TEXT,
  last_detail TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_schedules_project ON schedules(account_id, ref);
CREATE INDEX idx_schedules_next_run ON schedules(next_run_at);
CREATE TABLE notification_channels (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- l'URL d'un webhook Slack/Discord EST un secret : scellée, jamais rendue
  webhook_cipher TEXT,
  webhook_hint TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);
-- Anti-spam : plus haut niveau déjà notifié, par sujet et par période
CREATE TABLE alert_marks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  subject TEXT NOT NULL,
  period TEXT NOT NULL,
  rank INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, account_id, ref, subject, period)
);
`,
  },
];

/** Version atteinte après toutes les migrations. */
export const SCHEMA_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1]?.version ?? BASE_SCHEMA_VERSION;

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
}

export interface AccountRow {
  id: string;
  alias: string;
  color: string;
  enabled: boolean;
  patCipher: string;
  patHint: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface ProjectMetaRow {
  accountId: string;
  ref: string;
  tags: string[];
  favorite: boolean;
  demoFrequent: boolean;
  notes: string;
  firstSeenAt: string;
  lastSeenActiveAt: string | null;
  pausedAt: string | null;
  lastStatus: SupabaseProjectStatus;
}

export interface TotpRow {
  userId: string;
  secretCipher: string;
  enabled: boolean;
  lastStep: number | null;
  createdAt: string;
  enabledAt: string | null;
}

export interface PushSubscriptionRow {
  endpoint: string;
  userId: string;
  p256dh: string;
  auth: string;
  createdAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export type ScheduleRunStatus = NonNullable<ScheduleDto['lastStatus']>;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.db
      .prepare(
        `INSERT INTO meta(key, value) VALUES ('schema_version', ?)
         ON CONFLICT(key) DO NOTHING`
      )
      .run(String(BASE_SCHEMA_VERSION));
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  /** Version du schéma de CETTE base (après migrations). */
  schemaVersion(): number {
    return Number(this.getMeta('schema_version') ?? BASE_SCHEMA_VERSION);
  }

  private migrate(): void {
    let current = this.schemaVersion();
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      // IMMEDIATE : le verrou d'écriture est pris d'entrée, une seconde
      // instance qui démarrerait en même temps attend au lieu de rejouer.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(migration.sql);
        this.db
          .prepare(`UPDATE meta SET value=? WHERE key='schema_version'`)
          .run(String(migration.version));
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      current = migration.version;
    }
  }

  /* ── Méta serveur (clé → valeur) ────────────────────────────────────── */

  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as
      { value: string } | undefined;
    return r?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta(key, value) VALUES (?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`
      )
      .run(key, value);
  }

  /* ── Users ──────────────────────────────────────────────────────────── */

  countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as
      { n: number } | undefined;
    return row?.n ?? 0;
  }

  createUser(email: string, passwordHash: string, role: Role): UserRow {
    const user: UserRow = {
      id: randomUUID(),
      email: email.toLowerCase(),
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        'INSERT INTO users(id, email, password_hash, role, created_at) VALUES (?,?,?,?,?)'
      )
      .run(user.id, user.email, user.passwordHash, user.role, user.createdAt);
    return user;
  }

  findUserByEmail(email: string): UserRow | null {
    const r = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.toLowerCase()) as Record<string, unknown> | undefined;
    return r ? mapUser(r) : null;
  }

  getUser(id: string): UserRow | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return r ? mapUser(r) : null;
  }

  listUsers(): UserRow[] {
    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY created_at')
      .all() as Record<string, unknown>[];
    return rows.map(mapUser);
  }

  deleteUser(id: string): boolean {
    const res = this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /* ── Sessions ───────────────────────────────────────────────────────── */

  createSession(tokenHash: string, userId: string, ttlHours: number): void {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)'
      )
      .run(
        tokenHash,
        userId,
        new Date(now + ttlHours * 3_600_000).toISOString(),
        new Date(now).toISOString()
      );
  }

  findSessionUser(tokenHash: string): UserRow | null {
    const r = this.db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(tokenHash, new Date().toISOString()) as
      Record<string, unknown> | undefined;
    return r ? mapUser(r) : null;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  purgeExpiredSessions(): void {
    this.db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(new Date().toISOString());
  }

  /* ── Comptes Supabase ───────────────────────────────────────────────── */

  insertAccount(input: {
    alias: string;
    color: string;
    patCipher: string;
    patHint: string;
  }): AccountRow {
    const now = new Date().toISOString();
    const row: AccountRow = {
      id: randomUUID(),
      alias: input.alias,
      color: input.color,
      enabled: true,
      patCipher: input.patCipher,
      patHint: input.patHint,
      createdAt: now,
      updatedAt: now,
      lastSyncAt: null,
      lastError: null,
    };
    this.db
      .prepare(
        `INSERT INTO accounts(id, alias, color, enabled, pat_cipher, pat_hint, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        row.id,
        row.alias,
        row.color,
        1,
        row.patCipher,
        row.patHint,
        row.createdAt,
        row.updatedAt
      );
    return row;
  }

  listAccounts(): AccountRow[] {
    const rows = this.db
      .prepare('SELECT * FROM accounts ORDER BY created_at')
      .all() as Record<string, unknown>[];
    return rows.map(mapAccount);
  }

  getAccount(id: string): AccountRow | null {
    const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return r ? mapAccount(r) : null;
  }

  updateAccount(
    id: string,
    fields: Partial<
      Pick<AccountRow, 'alias' | 'color' | 'enabled' | 'patCipher' | 'patHint'>
    >
  ): AccountRow | null {
    const current = this.getAccount(id);
    if (!current) return null;
    const next: AccountRow = {
      ...current,
      ...fields,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE accounts SET alias=?, color=?, enabled=?, pat_cipher=?, pat_hint=?, updated_at=?
         WHERE id=?`
      )
      .run(
        next.alias,
        next.color,
        next.enabled ? 1 : 0,
        next.patCipher,
        next.patHint,
        next.updatedAt,
        id
      );
    return next;
  }

  setAccountSync(id: string, ok: boolean, error?: string): void {
    if (ok) {
      this.db
        .prepare(
          'UPDATE accounts SET last_sync_at=?, last_error=NULL WHERE id=?'
        )
        .run(new Date().toISOString(), id);
    } else {
      this.db
        .prepare('UPDATE accounts SET last_error=? WHERE id=?')
        .run(error ?? 'Erreur inconnue', id);
    }
  }

  deleteAccount(id: string): boolean {
    const res = this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /* ── Méta + observations projet ─────────────────────────────────────── */

  /**
   * Enregistre une observation de statut et maintient les dates dérivées :
   * - actif   → last_seen_active_at = now, paused_at remis à null ;
   * - INACTIVE observé après un état actif → paused_at = now (sinon conservé :
   *   si le projet était déjà en pause à la découverte, la date reste inconnue).
   */
  observeProject(
    accountId: string,
    ref: string,
    status: SupabaseProjectStatus,
    now: string = new Date().toISOString()
  ): ProjectMetaRow {
    const existing = this.getProjectMeta(accountId, ref);
    if (!existing) {
      const observed = observeStatusTransition(null, status, now);
      this.db
        .prepare(
          `INSERT INTO project_meta(account_id, ref, first_seen_at, last_seen_active_at, paused_at, last_status)
           VALUES (?,?,?,?,?,?)`
        )
        .run(
          accountId,
          ref,
          now,
          observed.lastSeenActiveAt,
          observed.pausedAt,
          status
        );
      return this.getProjectMeta(accountId, ref) as ProjectMetaRow;
    }

    const observed = observeStatusTransition(
      {
        lastSeenActiveAt: existing.lastSeenActiveAt,
        pausedAt: existing.pausedAt,
        lastStatus: existing.lastStatus,
      },
      status,
      now
    );
    this.db
      .prepare(
        `UPDATE project_meta SET last_seen_active_at=?, paused_at=?, last_status=?
         WHERE account_id=? AND ref=?`
      )
      .run(
        observed.lastSeenActiveAt,
        observed.pausedAt,
        status,
        accountId,
        ref
      );
    return { ...existing, ...observed, lastStatus: status };
  }

  /** Pose une date de pause certaine (pause déclenchée par Miss Supaboss). */
  markPausedByUs(accountId: string, ref: string): void {
    this.db
      .prepare(
        `UPDATE project_meta SET paused_at=? WHERE account_id=? AND ref=? AND paused_at IS NULL`
      )
      .run(new Date().toISOString(), accountId, ref);
  }

  getProjectMeta(accountId: string, ref: string): ProjectMetaRow | null {
    const r = this.db
      .prepare('SELECT * FROM project_meta WHERE account_id=? AND ref=?')
      .get(accountId, ref) as Record<string, unknown> | undefined;
    return r ? mapMeta(r) : null;
  }

  setProjectMeta(
    accountId: string,
    ref: string,
    fields: Partial<
      Pick<ProjectMetaRow, 'tags' | 'favorite' | 'demoFrequent' | 'notes'>
    >
  ): ProjectMetaRow | null {
    const current =
      this.getProjectMeta(accountId, ref) ??
      this.observeProject(accountId, ref, 'UNKNOWN');
    const next = { ...current, ...fields };
    this.db
      .prepare(
        `UPDATE project_meta SET tags=?, favorite=?, demo_frequent=?, notes=?
         WHERE account_id=? AND ref=?`
      )
      .run(
        JSON.stringify(next.tags),
        next.favorite ? 1 : 0,
        next.demoFrequent ? 1 : 0,
        next.notes,
        accountId,
        ref
      );
    return next;
  }

  /* ── Journal d'audit / historique ───────────────────────────────────── */

  recordOperation(op: {
    userEmail: string;
    action: OperationAction;
    accountId?: string | null;
    accountAlias?: string | null;
    projectRef?: string | null;
    projectName?: string | null;
    status: 'ok' | 'error' | 'pending';
    detail?: string | null;
  }): number {
    const res = this.db
      .prepare(
        `INSERT INTO operations(ts, user_email, action, account_id, account_alias, project_ref, project_name, status, detail)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        new Date().toISOString(),
        op.userEmail,
        op.action,
        op.accountId ?? null,
        op.accountAlias ?? null,
        op.projectRef ?? null,
        op.projectName ?? null,
        op.status,
        op.detail ?? null
      );
    return Number(res.lastInsertRowid);
  }

  updateOperation(id: number, status: 'ok' | 'error', detail?: string): void {
    this.db
      .prepare(
        'UPDATE operations SET status=?, detail=COALESCE(?, detail) WHERE id=?'
      )
      .run(status, detail ?? null, id);
  }

  listOperations(
    limit = 100,
    accountId?: string,
    ref?: string
  ): OperationDto[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (accountId) {
      clauses.push('account_id = ?');
      params.push(accountId);
    }
    if (ref) {
      clauses.push('project_ref = ?');
      params.push(ref);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM operations ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, Math.min(limit, 500)) as Record<string, unknown>[];
    return rows.map(mapOperation);
  }

  /* ── Réglages utilisateur ───────────────────────────────────────────── */

  getSettings(userId: string): SettingsDto {
    const r = this.db
      .prepare('SELECT json FROM user_settings WHERE user_id=?')
      .get(userId) as { json: string } | undefined;
    if (!r) return DEFAULT_SETTINGS;
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(r.json) as SettingsDto) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  putSettings(userId: string, settings: SettingsDto): void {
    this.db
      .prepare(
        `INSERT INTO user_settings(user_id, json) VALUES (?,?)
         ON CONFLICT(user_id) DO UPDATE SET json=excluded.json`
      )
      .run(userId, JSON.stringify(settings));
  }

  /* ── Cache métriques (dernier état connu, y c. projets en pause) ────── */

  upsertMetric(accountId: string, ref: string, metric: MetricValue): void {
    this.db
      .prepare(
        `INSERT INTO metrics_cache(account_id, ref, kind, state, value, measured_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(account_id, ref, kind) DO UPDATE
           SET state=excluded.state, value=excluded.value, measured_at=excluded.measured_at`
      )
      .run(
        accountId,
        ref,
        metric.kind,
        metric.state,
        metric.value,
        metric.measuredAt
      );
  }

  getMetrics(accountId: string, ref: string): MetricValue[] {
    const rows = this.db
      .prepare('SELECT * FROM metrics_cache WHERE account_id=? AND ref=?')
      .all(accountId, ref) as Record<string, unknown>[];
    return rows.map(r => {
      const kind = String(r.kind) as MetricKind;
      return {
        kind,
        state: String(r.state) as MetricState,
        value: r.value === null ? null : Number(r.value),
        quota: FREE_PLAN_QUOTAS[kind],
        measuredAt: (r.measured_at as string | null) ?? null,
      };
    });
  }

  /** Dernière opération d'une action pour un utilisateur (ex. dernière remise). */
  lastOperation(
    action: OperationAction,
    userEmail: string
  ): OperationDto | null {
    const r = this.db
      .prepare(
        `SELECT * FROM operations WHERE action=? AND user_email=?
         ORDER BY id DESC LIMIT 1`
      )
      .get(action, userEmail) as Record<string, unknown> | undefined;
    return r ? mapOperation(r) : null;
  }

  /* ── Double authentification (TOTP) ─────────────────────────────────── */

  getTotp(userId: string): TotpRow | null {
    const r = this.db
      .prepare('SELECT * FROM user_totp WHERE user_id=?')
      .get(userId) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      userId: String(r.user_id),
      secretCipher: String(r.secret_cipher),
      enabled: Number(r.enabled) === 1,
      lastStep: r.last_step === null ? null : Number(r.last_step),
      createdAt: String(r.created_at),
      enabledAt: (r.enabled_at as string | null) ?? null,
    };
  }

  /** (Re)pose un secret EN ATTENTE ; refusé si la 2FA est déjà active. */
  savePendingTotp(userId: string, secretCipher: string): boolean {
    const res = this.db
      .prepare(
        `INSERT INTO user_totp(user_id, secret_cipher, enabled, last_step, created_at)
         VALUES (?,?,0,NULL,?)
         ON CONFLICT(user_id) DO UPDATE
           SET secret_cipher=excluded.secret_cipher, last_step=NULL,
               created_at=excluded.created_at
           WHERE user_totp.enabled = 0`
      )
      .run(userId, secretCipher, new Date().toISOString());
    return res.changes > 0;
  }

  /** Active la 2FA en mémorisant le pas du code qui l'a confirmée. */
  enableTotp(userId: string, step: number): boolean {
    const res = this.db
      .prepare(
        `UPDATE user_totp SET enabled=1, last_step=?, enabled_at=?
         WHERE user_id=? AND enabled=0`
      )
      .run(step, new Date().toISOString(), userId);
    return res.changes > 0;
  }

  /**
   * Consomme un pas TOTP. ATOMIQUE : deux requêtes simultanées portant le
   * même code ne peuvent pas toutes deux réussir — la seconde trouve
   * `last_step` déjà avancé et ne modifie rien.
   */
  claimTotpStep(userId: string, step: number): boolean {
    const res = this.db
      .prepare(
        `UPDATE user_totp SET last_step=?
         WHERE user_id=? AND enabled=1 AND (last_step IS NULL OR last_step < ?)`
      )
      .run(step, userId, step);
    return res.changes > 0;
  }

  /** Retire la 2FA, ses codes de secours et ses étapes de connexion en cours. */
  deleteTotp(userId: string): void {
    this.db.prepare('DELETE FROM user_totp WHERE user_id=?').run(userId);
    this.db
      .prepare('DELETE FROM totp_recovery_codes WHERE user_id=?')
      .run(userId);
    this.db.prepare('DELETE FROM login_challenges WHERE user_id=?').run(userId);
  }

  replaceRecoveryCodes(userId: string, hashes: readonly string[]): void {
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('DELETE FROM totp_recovery_codes WHERE user_id=?')
        .run(userId);
      const insert = this.db.prepare(
        'INSERT INTO totp_recovery_codes(user_id, code_hash) VALUES (?,?)'
      );
      for (const hash of hashes) insert.run(userId, hash);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listUnusedRecoveryCodes(userId: string): { id: number; hash: string }[] {
    const rows = this.db
      .prepare(
        `SELECT id, code_hash FROM totp_recovery_codes
         WHERE user_id=? AND used_at IS NULL ORDER BY id`
      )
      .all(userId) as { id: number; code_hash: string }[];
    return rows.map(r => ({ id: Number(r.id), hash: String(r.code_hash) }));
  }

  /** Brûle un code de secours — atomique, comme `claimTotpStep`. */
  useRecoveryCode(id: number): boolean {
    const res = this.db
      .prepare(
        'UPDATE totp_recovery_codes SET used_at=? WHERE id=? AND used_at IS NULL'
      )
      .run(new Date().toISOString(), id);
    return res.changes > 0;
  }

  countUnusedRecoveryCodes(userId: string): number {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM totp_recovery_codes
         WHERE user_id=? AND used_at IS NULL`
      )
      .get(userId) as { n: number } | undefined;
    return Number(r?.n ?? 0);
  }

  /* ── Étapes de connexion (mot de passe accepté, code attendu) ───────── */

  createLoginChallenge(
    tokenHash: string,
    userId: string,
    ttlSeconds: number
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO login_challenges(token_hash, user_id, expires_at, created_at)
         VALUES (?,?,?,?)`
      )
      .run(
        tokenHash,
        userId,
        new Date(now + ttlSeconds * 1000).toISOString(),
        new Date(now).toISOString()
      );
  }

  findLoginChallenge(
    tokenHash: string
  ): { userId: string; attempts: number } | null {
    const r = this.db
      .prepare(
        `SELECT user_id, attempts FROM login_challenges
         WHERE token_hash=? AND expires_at > ?`
      )
      .get(tokenHash, new Date().toISOString()) as
      { user_id: string; attempts: number } | undefined;
    return r
      ? { userId: String(r.user_id), attempts: Number(r.attempts) }
      : null;
  }

  /** Compte un échec ; au-delà de `maxAttempts`, l'étape est brûlée. */
  recordChallengeFailure(tokenHash: string, maxAttempts: number): void {
    this.db
      .prepare(
        'UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash=?'
      )
      .run(tokenHash);
    this.db
      .prepare(
        'DELETE FROM login_challenges WHERE token_hash=? AND attempts >= ?'
      )
      .run(tokenHash, maxAttempts);
  }

  deleteLoginChallenge(tokenHash: string): void {
    this.db
      .prepare('DELETE FROM login_challenges WHERE token_hash=?')
      .run(tokenHash);
  }

  purgeExpiredChallenges(): void {
    this.db
      .prepare('DELETE FROM login_challenges WHERE expires_at <= ?')
      .run(new Date().toISOString());
  }

  /* ── Plannings ──────────────────────────────────────────────────────── */

  insertSchedule(input: {
    accountId: string;
    ref: string;
    action: ScheduleDto['action'];
    kind: ScheduleDto['kind'];
    at: string | null;
    weekday: number | null;
    time: string | null;
    timezone: string;
    nextRunAt: string | null;
    createdBy: string;
  }): ScheduleDto {
    const row: ScheduleDto = {
      id: randomUUID(),
      ...input,
      lastRunAt: null,
      lastStatus: null,
      lastDetail: null,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO schedules(id, account_id, ref, action, kind, at_local, weekday,
           time_local, timezone, next_run_at, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        row.id,
        row.accountId,
        row.ref,
        row.action,
        row.kind,
        row.at,
        row.weekday,
        row.time,
        row.timezone,
        row.nextRunAt,
        row.createdBy,
        row.createdAt
      );
    return row;
  }

  listSchedules(accountId: string, ref: string): ScheduleDto[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM schedules WHERE account_id=? AND ref=?
         ORDER BY next_run_at IS NULL, next_run_at, created_at`
      )
      .all(accountId, ref) as Record<string, unknown>[];
    return rows.map(mapSchedule);
  }

  getSchedule(id: string): ScheduleDto | null {
    const r = this.db.prepare('SELECT * FROM schedules WHERE id=?').get(id) as
      Record<string, unknown> | undefined;
    return r ? mapSchedule(r) : null;
  }

  deleteSchedule(id: string): boolean {
    return (
      this.db.prepare('DELETE FROM schedules WHERE id=?').run(id).changes > 0
    );
  }

  countSchedules(accountId: string, ref: string): number {
    const r = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM schedules WHERE account_id=? AND ref=?'
      )
      .get(accountId, ref) as { n: number } | undefined;
    return Number(r?.n ?? 0);
  }

  /** Échéances dues (ISO UTC, comparables en chaîne), la plus ancienne d'abord. */
  listDueSchedules(nowIso: string): ScheduleDto[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM schedules
         WHERE next_run_at IS NOT NULL AND next_run_at <= ?
         ORDER BY next_run_at`
      )
      .all(nowIso) as Record<string, unknown>[];
    return rows.map(mapSchedule);
  }

  /**
   * Réserve UNE exécution : avance `next_run_at` AVANT d'agir, à condition
   * qu'il vaille encore ce qu'on a lu. Deux passages concurrents ne peuvent
   * pas réserver la même échéance, et un arrêt pendant l'exécution ne la
   * rejoue pas au redémarrage (au plus une fois, jamais deux).
   */
  claimScheduleRun(
    id: string,
    expectedNextRunAt: string,
    nextRunAt: string | null,
    runAt: string
  ): boolean {
    const res = this.db
      .prepare(
        `UPDATE schedules
         SET next_run_at=?, last_run_at=?, last_status='running', last_detail=NULL
         WHERE id=? AND next_run_at=?`
      )
      .run(nextRunAt, runAt, id, expectedNextRunAt);
    return res.changes > 0;
  }

  finishScheduleRun(
    id: string,
    status: ScheduleRunStatus,
    detail: string | null
  ): void {
    this.db
      .prepare('UPDATE schedules SET last_status=?, last_detail=? WHERE id=?')
      .run(status, detail, id);
  }

  /** Exécutions restées « en cours » : le processus s'est arrêté pendant. */
  listRunningSchedules(): ScheduleDto[] {
    const rows = this.db
      .prepare(`SELECT * FROM schedules WHERE last_status='running'`)
      .all() as Record<string, unknown>[];
    return rows.map(mapSchedule);
  }

  /* ── Canaux de notification ─────────────────────────────────────────── */

  getWebhook(userId: string): { cipher: string; hint: string } | null {
    const r = this.db
      .prepare(
        'SELECT webhook_cipher, webhook_hint FROM notification_channels WHERE user_id=?'
      )
      .get(userId) as
      | { webhook_cipher: string | null; webhook_hint: string | null }
      | undefined;
    if (!r?.webhook_cipher) return null;
    return { cipher: r.webhook_cipher, hint: r.webhook_hint ?? '' };
  }

  setWebhook(userId: string, cipher: string | null, hint: string | null): void {
    this.db
      .prepare(
        `INSERT INTO notification_channels(user_id, webhook_cipher, webhook_hint, updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET webhook_cipher=excluded.webhook_cipher,
           webhook_hint=excluded.webhook_hint, updated_at=excluded.updated_at`
      )
      .run(userId, cipher, hint, new Date().toISOString());
  }

  /**
   * Un navigateur = un endpoint. S'il était rattaché à un autre utilisateur
   * (poste partagé), il passe à celui qui vient de s'abonner.
   */
  upsertPushSubscription(
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string }
  ): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions(endpoint, user_id, p256dh, auth, created_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,
           p256dh=excluded.p256dh, auth=excluded.auth, last_error=NULL`
      )
      .run(
        sub.endpoint,
        userId,
        sub.p256dh,
        sub.auth,
        new Date().toISOString()
      );
  }

  deletePushSubscription(userId: string, endpoint: string): boolean {
    const res = this.db
      .prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?')
      .run(userId, endpoint);
    return res.changes > 0;
  }

  /** Abonnement expiré (404/410 du service push) : on l'oublie. */
  forgetPushEndpoint(endpoint: string): void {
    this.db
      .prepare('DELETE FROM push_subscriptions WHERE endpoint=?')
      .run(endpoint);
  }

  listPushSubscriptions(userId: string): PushSubscriptionRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM push_subscriptions WHERE user_id=? ORDER BY created_at'
      )
      .all(userId) as Record<string, unknown>[];
    return rows.map(r => ({
      endpoint: String(r.endpoint),
      userId: String(r.user_id),
      p256dh: String(r.p256dh),
      auth: String(r.auth),
      createdAt: String(r.created_at),
      lastSuccessAt: (r.last_success_at as string | null) ?? null,
      lastError: (r.last_error as string | null) ?? null,
    }));
  }

  recordPushDelivery(endpoint: string, error: string | null): void {
    if (error === null) {
      this.db
        .prepare(
          'UPDATE push_subscriptions SET last_success_at=?, last_error=NULL WHERE endpoint=?'
        )
        .run(new Date().toISOString(), endpoint);
    } else {
      this.db
        .prepare('UPDATE push_subscriptions SET last_error=? WHERE endpoint=?')
        .run(error, endpoint);
    }
  }

  /** Utilisateurs joignables : au moins un appareil abonné ou un webhook. */
  listAlertRecipients(): UserRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM users u WHERE
           EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
           OR EXISTS (SELECT 1 FROM notification_channels c
                      WHERE c.user_id = u.id AND c.webhook_cipher IS NOT NULL)
         ORDER BY created_at`
      )
      .all() as Record<string, unknown>[];
    return rows.map(mapUser);
  }

  /**
   * Réserve une alerte : vrai si `rank` dépasse ce qui a déjà été notifié
   * pour ce sujet et cette période. Posé AVANT l'envoi — une alerte ne part
   * qu'une fois, même si deux synchros se croisent.
   */
  claimAlertMark(mark: {
    userId: string;
    accountId: string;
    ref: string;
    subject: string;
    period: string;
    rank: number;
  }): boolean {
    const res = this.db
      .prepare(
        `INSERT INTO alert_marks(user_id, account_id, ref, subject, period, rank, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(user_id, account_id, ref, subject, period) DO UPDATE
           SET rank=excluded.rank, updated_at=excluded.updated_at
           WHERE excluded.rank > alert_marks.rank`
      )
      .run(
        mark.userId,
        mark.accountId,
        mark.ref,
        mark.subject,
        mark.period,
        mark.rank,
        new Date().toISOString()
      );
    return res.changes > 0;
  }
}

/* ── Mapping lignes SQLite → objets typés ─────────────────────────────── */

function mapOperation(r: Record<string, unknown>): OperationDto {
  return {
    id: Number(r.id),
    ts: String(r.ts),
    userEmail: String(r.user_email),
    action: String(r.action) as OperationDto['action'],
    accountId: (r.account_id as string | null) ?? null,
    accountAlias: (r.account_alias as string | null) ?? null,
    projectRef: (r.project_ref as string | null) ?? null,
    projectName: (r.project_name as string | null) ?? null,
    status: String(r.status) as OperationDto['status'],
    detail: (r.detail as string | null) ?? null,
  };
}

function mapSchedule(r: Record<string, unknown>): ScheduleDto {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    ref: String(r.ref),
    action: String(r.action) as ScheduleDto['action'],
    kind: String(r.kind) as ScheduleDto['kind'],
    at: (r.at_local as string | null) ?? null,
    weekday: r.weekday === null ? null : Number(r.weekday),
    time: (r.time_local as string | null) ?? null,
    timezone: String(r.timezone),
    nextRunAt: (r.next_run_at as string | null) ?? null,
    lastRunAt: (r.last_run_at as string | null) ?? null,
    lastStatus: (r.last_status as ScheduleDto['lastStatus']) ?? null,
    lastDetail: (r.last_detail as string | null) ?? null,
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
  };
}

function mapUser(r: Record<string, unknown>): UserRow {
  return {
    id: String(r.id),
    email: String(r.email),
    passwordHash: String(r.password_hash),
    role: String(r.role) as Role,
    createdAt: String(r.created_at),
  };
}

function mapAccount(r: Record<string, unknown>): AccountRow {
  return {
    id: String(r.id),
    alias: String(r.alias),
    color: String(r.color),
    enabled: Number(r.enabled) === 1,
    patCipher: String(r.pat_cipher),
    patHint: String(r.pat_hint),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    lastSyncAt: (r.last_sync_at as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
  };
}

function mapMeta(r: Record<string, unknown>): ProjectMetaRow {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(r.tags));
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    // tags illisibles → liste vide, jamais de crash
  }
  return {
    accountId: String(r.account_id),
    ref: String(r.ref),
    tags,
    favorite: Number(r.favorite) === 1,
    demoFrequent: Number(r.demo_frequent) === 1,
    notes: String(r.notes ?? ''),
    firstSeenAt: String(r.first_seen_at),
    lastSeenActiveAt: (r.last_seen_active_at as string | null) ?? null,
    pausedAt: (r.paused_at as string | null) ?? null,
    lastStatus: String(r.last_status) as SupabaseProjectStatus,
  };
}
