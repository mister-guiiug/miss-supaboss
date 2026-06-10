/**
 * Persistance serveur — SQLite natif (node:sqlite, Node ≥ 22.13).
 * Tout passe par `Store` : aucune requête SQL hors de ce fichier.
 *
 * Note RGPD/sécurité : la table `accounts` ne contient le PAT que chiffré
 * (AES-256-GCM, clé maître hors base). `operations` est le journal d'audit.
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
import { countsTowardActiveLimit } from '../../shared/status.ts';
import type { SupabaseProjectStatus } from '../../shared/status.ts';
import type {
  OperationAction,
  OperationDto,
  Role,
  SettingsDto,
} from '../../shared/contracts.ts';
import { DEFAULT_SETTINGS } from '../../shared/contracts.ts';

const SCHEMA_VERSION = 1;

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
      .run(String(SCHEMA_VERSION));
  }

  close(): void {
    this.db.close();
  }

  /* ── Users ──────────────────────────────────────────────────────────── */

  countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as
      | { n: number }
      | undefined;
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
      | Record<string, unknown>
      | undefined;
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
      | Record<string, unknown>
      | undefined;
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
      const active = countsTowardActiveLimit(status);
      this.db
        .prepare(
          `INSERT INTO project_meta(account_id, ref, first_seen_at, last_seen_active_at, paused_at, last_status)
           VALUES (?,?,?,?,?,?)`
        )
        .run(accountId, ref, now, active ? now : null, null, status);
      return this.getProjectMeta(accountId, ref) as ProjectMetaRow;
    }

    let lastSeenActiveAt = existing.lastSeenActiveAt;
    let pausedAt = existing.pausedAt;
    if (countsTowardActiveLimit(status)) {
      lastSeenActiveAt = now;
      pausedAt = null;
    } else if (
      status === 'INACTIVE' &&
      existing.lastStatus !== 'INACTIVE' &&
      pausedAt === null
    ) {
      pausedAt = countsTowardActiveLimit(existing.lastStatus) ? now : null;
    }
    this.db
      .prepare(
        `UPDATE project_meta SET last_seen_active_at=?, paused_at=?, last_status=?
         WHERE account_id=? AND ref=?`
      )
      .run(lastSeenActiveAt, pausedAt, status, accountId, ref);
    return { ...existing, lastSeenActiveAt, pausedAt, lastStatus: status };
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
    return rows.map(r => ({
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
    }));
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
}

/* ── Mapping lignes SQLite → objets typés ─────────────────────────────── */

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
