/**
 * API « réelle local-first » : la PWA (GitHub Pages, sans backend) interroge
 * directement la Supabase Management API via le proxy CORS
 * (cf. proxy/ — Cloudflare Worker). Les comptes, le PAT et les
 * métadonnées (tags/favoris/notes/observations) sont stockés EN LOCAL
 * (localStorage) sur l'appareil — le PAT n'est transmis qu'au proxy.
 *
 * Différences avec le serveur Fastify : chiffrement au repos OBLIGATOIRE via
 * le coffre (phrase secrète) avant tout PAT, pas de RBAC (l'utilisateur est
 * admin de sa propre instance). Egress reste « non disponible » (pas d'endpoint).
 */
import {
  DEFAULT_SETTINGS,
  type AccountDto,
  type OperationDto,
  type ProjectDto,
  type ProjectMetricsDto,
  type SettingsDto,
  type UserDto,
} from '../../shared/contracts.ts';
import {
  assessRestore,
  buildProjectMeta,
  FLEET_TTL_MS,
  METRICS_TTL_MS,
  observeStatusTransition,
  pausesBeforeRestore,
  readFleetCache,
  toRestoreAssessmentDto,
  validatePause,
  validateRestore,
} from '../../shared/fleet/index.ts';
import {
  PREVIOUS_RESTORE_WINDOW_DAYS,
  RESTORE_WINDOW_DAYS,
} from '../../shared/guards.ts';
import type { SupabaseProjectStatus } from '../../shared/status.ts';
import { countsTowardActiveLimit } from '../../shared/status.ts';
import {
  FREE_PLAN_QUOTAS,
  unavailableMetric,
  type MetricKind,
  type MetricValue,
} from '../../shared/quotas.ts';
import type { RawProject } from '../../shared/supabaseApi.ts';
import { ApiError, type Api } from './types.ts';
import { BrowserManagementClient } from './management/browserClient.ts';
import { patVault } from './crypto/patVault.ts';
import {
  openPortableAccounts,
  sealPortableAccounts,
} from './crypto/portableExport.ts';
import { metricHistory } from './metricHistory.ts';
import { classifySyncError } from './syncError.ts';

/** TTL du sondage GET /restore (ms) — 6 h, la fenêtre Free ne bouge pas vite. */
const RESTORE_API_TTL_MS = 6 * 60 * 60 * 1000;

const LOCAL_USER: UserDto = {
  id: 'local',
  email: 'local@miss-supaboss.app',
  role: 'admin',
};

/** État réel persisté localement (séparé des fixtures de démo). */
export const REAL_STORAGE_KEY = 'miss-supaboss-real-v1';

interface RealAccount {
  id: string;
  alias: string;
  color: string;
  enabled: boolean;
  /**
   * PAT en clair EN MÉMOIRE (jamais envoyé ailleurs qu'au proxy). Vide tant que
   * le coffre est verrouillé — `vault.unlock` le repeuple depuis `patEnc`.
   */
  pat: string;
  /** PAT chiffré au repos (présent uniquement si le coffre est activé). */
  patEnc?: string;
  patHint: string;
  createdAt: string;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Rappel local YYYY-MM-DD — expiration PAT saisie à la main. */
  patExpiresAt?: string | null;
}

interface RealMeta {
  tags: string[];
  favorite: boolean;
  demoFrequent: boolean;
  notes: string;
  lastSeenActiveAt: string | null;
  pausedAt: string | null;
  lastStatus?: SupabaseProjectStatus;
  keepAliveOptIn?: boolean;
  /** Cache du dernier sondage GET /restore (évite de re-frapper à chaque sync). */
  restoreApi?: { at: number; source: 'api-ok' | 'api-blocked' };
}

/**
 * Révision du format de l'état local. Absente = 1.
 * 2 : la fenêtre de restauration passe d'une estimation de 90 jours à un an.
 */
const STATE_REVISION = 2;

interface RealState {
  accounts: RealAccount[];
  /** Clé `${accountId}:${ref}` → métadonnées locales. */
  meta: Record<string, RealMeta>;
  operations: OperationDto[];
  settings: SettingsDto;
  opSeq: number;
  revision?: number;
}

function emptyState(): RealState {
  return {
    accounts: [],
    meta: {},
    operations: [],
    settings: DEFAULT_SETTINGS,
    opSeq: 0,
    revision: STATE_REVISION,
  };
}

function loadState(): RealState {
  try {
    const raw = localStorage.getItem(REAL_STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<RealState>;
      const parsed = { ...emptyState(), ...stored };
      // Coffre activé : le PAT en clair n'est pas persisté → `pat` absent
      // jusqu'au déverrouillage. On garantit une chaîne (jamais undefined).
      parsed.accounts = parsed.accounts.map(a => ({ ...a, pat: a.pat ?? '' }));
      // L'état entier est enregistré, réglages compris : tout appareil qui a
      // ajouté un compte a donc figé l'ancien défaut de 90 jours. Porté à un
      // an UNE fois (révision 1 → 2) ; un 90 choisi ensuite est respecté. On
      // lit la révision STOCKÉE : celle de `emptyState()` masquerait l'absence.
      if (
        (stored.revision ?? 1) < 2 &&
        parsed.settings.restoreWindowDays === PREVIOUS_RESTORE_WINDOW_DAYS
      )
        parsed.settings = {
          ...parsed.settings,
          restoreWindowDays: RESTORE_WINDOW_DAYS,
        };
      parsed.revision = STATE_REVISION;
      return parsed;
    }
  } catch {
    // état corrompu → repart vide
  }
  return emptyState();
}

const metaKey = (accountId: string, ref: string): string =>
  `${accountId}:${ref}`;

function toAccountDto(a: RealAccount): AccountDto {
  return {
    id: a.id,
    alias: a.alias,
    color: a.color,
    enabled: a.enabled,
    patHint: a.patHint,
    createdAt: a.createdAt,
    lastSyncAt: a.lastSyncAt,
    lastError: a.lastError,
    patExpiresAt: a.patExpiresAt ?? null,
  };
}

export function createLocalRealApi(proxyBase: string): Api {
  const state = loadState();
  const client = new BrowserManagementClient(proxyBase);
  const cache = new Map<
    string,
    {
      fleet: ProjectDto[];
      orgs: string[];
      organizations: { slug: string; name: string }[];
      at: number;
    }
  >();
  const metricsCache = new Map<
    string,
    { metrics: MetricValue[]; at: number }
  >();

  const save = (): void => {
    try {
      // Coffre activé → on persiste le PAT chiffré (`patEnc`) et JAMAIS le clair.
      // Coffre désactivé → comportement historique : PAT en clair, pas de blob.
      const encrypted = patVault.isEnabled();
      const accounts = state.accounts.map(({ pat, patEnc, ...rest }) =>
        encrypted ? { ...rest, patEnc } : { ...rest, pat }
      );
      localStorage.setItem(
        REAL_STORAGE_KEY,
        JSON.stringify({ ...state, accounts })
      );
    } catch {
      // stockage indisponible : on continue en mémoire
    }
  };

  const getAccount = (id: string): RealAccount => {
    const a = state.accounts.find(x => x.id === id);
    if (!a) throw new ApiError(404, 'account-not-found', 'Compte introuvable');
    return a;
  };

  const recordOp = (
    op: Omit<OperationDto, 'id' | 'ts' | 'userEmail'>
  ): void => {
    state.opSeq += 1;
    state.operations.unshift({
      ...op,
      id: state.opSeq,
      ts: new Date().toISOString(),
      userEmail: LOCAL_USER.email,
    });
    state.operations = state.operations.slice(0, 200);
  };

  /** Récupère/initialise la méta locale et l'« observe » selon le statut live. */
  const observe = (accountId: string, raw: RawProject): RealMeta => {
    const key = metaKey(accountId, raw.ref);
    const existing = state.meta[key];
    const now = new Date().toISOString();
    const observed = observeStatusTransition(
      existing
        ? {
            lastSeenActiveAt: existing.lastSeenActiveAt,
            pausedAt: existing.pausedAt,
            lastStatus: existing.lastStatus ?? 'UNKNOWN',
          }
        : null,
      raw.status,
      now
    );
    const meta: RealMeta = {
      tags: existing?.tags ?? [],
      favorite: existing?.favorite ?? false,
      demoFrequent: existing?.demoFrequent ?? false,
      notes: existing?.notes ?? '',
      lastSeenActiveAt: observed.lastSeenActiveAt,
      pausedAt: observed.pausedAt,
      lastStatus: observed.lastStatus,
      keepAliveOptIn: existing?.keepAliveOptIn,
      restoreApi: existing?.restoreApi,
    };
    state.meta[key] = meta;
    return meta;
  };

  const toDto = async (
    accountId: string,
    raw: RawProject,
    orgName: string,
    pat: string
  ): Promise<ProjectDto> => {
    const meta = observe(accountId, raw);
    let apiDeadline: {
      deadline: string | null;
      source: 'api-ok' | 'api-blocked';
    } | null = null;
    if (raw.status === 'INACTIVE') {
      const cached = meta.restoreApi;
      if (cached && Date.now() - cached.at < RESTORE_API_TTL_MS) {
        apiDeadline = {
          source: cached.source,
          deadline:
            cached.source === 'api-blocked' ? new Date(0).toISOString() : null,
        };
      } else {
        try {
          // GET /restore : 200 = encore restaurable ; 400/404/410 = fenêtre close.
          // Pas d'échéance Free Plan dans la réponse — on affine seulement le statut.
          const result = await client.listRestoreVersions(pat, raw.ref);
          const source = result.ok ? 'api-ok' : 'api-blocked';
          meta.restoreApi = { at: Date.now(), source };
          state.meta[metaKey(accountId, raw.ref)] = meta;
          apiDeadline = {
            source,
            deadline:
              source === 'api-blocked' ? new Date(0).toISOString() : null,
          };
        } catch {
          // 401/403/réseau : on garde l'estimation, sans polluer restoreApi.
        }
      }
    }
    return {
      accountId,
      ref: raw.ref,
      name: raw.name,
      region: raw.region,
      organizationSlug: raw.organizationSlug,
      organizationName: orgName,
      status: raw.status,
      createdAt: raw.createdAt,
      meta: buildProjectMeta(
        {
          tags: meta.tags,
          favorite: meta.favorite,
          demoFrequent: meta.demoFrequent,
          notes: meta.notes,
          keepAliveOptIn: meta.keepAliveOptIn,
        },
        meta,
        state.settings.restoreWindowDays,
        apiDeadline
      ),
    };
  };

  /** Charge orgs + projets live d'un compte (PAT), construit les ProjectDto. */
  const loadAccountFleet = async (
    acc: RealAccount,
    refresh: boolean
  ): Promise<{
    orgs: string[];
    organizations: { slug: string; name: string }[];
    projects: ProjectDto[];
  }> => {
    const cached = cache.get(acc.id);
    const hit = readFleetCache(
      cached
        ? {
            value: {
              orgs: cached.orgs,
              organizations: cached.organizations,
              projects: cached.fleet,
            },
            at: cached.at,
          }
        : undefined,
      refresh,
      FLEET_TTL_MS
    );
    if (hit) return hit;
    // Orgs d'abord : listProjects s'appuie sur leur slug pour l'inventaire
    // paginé /v1/organizations/{slug}/projects (et évite un second GET orgs).
    const organizations = await client.listOrganizations(acc.pat);
    const rawProjects = await client.listProjects(acc.pat, organizations);
    const orgNames = new Map(organizations.map(o => [o.slug, o.name]));
    const projects = await Promise.all(
      rawProjects.map(raw =>
        toDto(
          acc.id,
          raw,
          orgNames.get(raw.organizationSlug) ?? raw.organizationSlug,
          acc.pat
        )
      )
    );
    const orgs = organizations.map(o => o.name);
    const orgList = organizations.map(o => ({ slug: o.slug, name: o.name }));
    cache.set(acc.id, {
      fleet: projects,
      orgs,
      organizations: orgList,
      at: Date.now(),
    });
    acc.lastSyncAt = new Date().toISOString();
    acc.lastError = null;
    return { orgs, organizations: orgList, projects };
  };

  const toLite = (projects: ProjectDto[]) =>
    projects.map(dto => ({
      ref: dto.ref,
      name: dto.name,
      status: dto.status,
      favorite: dto.meta.favorite,
      demoFrequent: dto.meta.demoFrequent,
      tags: dto.meta.tags,
      lastSeenActiveAt: dto.meta.lastSeenActiveAt,
      dto,
    }));

  /** Projets live d'un compte (cache court), pour les actions/garde-fous. */
  const projectsOf = async (
    accountId: string,
    refresh: boolean
  ): Promise<ProjectDto[]> => {
    const acc = getAccount(accountId);
    const { projects } = await loadAccountFleet(acc, refresh);
    return projects;
  };

  const buildMetric = (
    kind: MetricKind,
    value: number | null,
    src: 'measured' | 'estimated',
    measuredAt: string
  ): MetricValue =>
    value === null
      ? unavailableMetric(kind)
      : { kind, state: src, value, quota: FREE_PLAN_QUOTAS[kind], measuredAt };

  /** Métriques d'UN projet : SQL read-only via le proxy si actif + cache TTL.
   *  Egress reste indisponible ; projet en pause / mesure ancienne → 'stale'.
   *  `refreshFailed` : un rafraîchissement live a été tenté mais a échoué (dur)
   *  → distinct d'une métrique « non disponible ». */
  const collectProjectMetrics = async (
    acc: RealAccount,
    project: ProjectDto,
    refresh: boolean
  ): Promise<{ dto: ProjectMetricsDto; refreshFailed: boolean }> => {
    const key = metaKey(acc.id, project.ref);
    const isActive = countsTowardActiveLimit(project.status);
    const cached = metricsCache.get(key);
    const fresh = !!cached && Date.now() - cached.at < METRICS_TTL_MS;
    let refreshFailed = false;
    if (isActive && (refresh || !fresh)) {
      try {
        const m = await client.collectMetrics(acc.pat, project.ref);
        if (m.failed) {
          // proxy/PAT en cause → on garde le cache (ou indisponible) et on signale
          refreshFailed = true;
        } else {
          const at = new Date().toISOString();
          const metrics = [
            unavailableMetric('egress'),
            buildMetric('dbSize', m.dbSizeBytes, 'measured', at),
            buildMetric('mau', m.mau, 'estimated', at),
            buildMetric('storage', m.storageBytes, 'measured', at),
          ];
          metricsCache.set(key, { at: Date.now(), metrics });
          for (const mv of metrics) {
            metricHistory.record(acc.id, project.ref, mv.kind, mv.value);
          }
        }
      } catch {
        refreshFailed = true;
      }
    }
    const entry = metricsCache.get(key);
    if (!entry) {
      return {
        dto: {
          accountId: acc.id,
          ref: project.ref,
          metrics: (['egress', 'dbSize', 'mau', 'storage'] as const).map(
            unavailableMetric
          ),
        },
        refreshFailed,
      };
    }
    const stillFresh = Date.now() - entry.at < METRICS_TTL_MS;
    const metrics = entry.metrics.map(mv =>
      mv.value === null || (isActive && stillFresh)
        ? mv
        : { ...mv, state: 'stale' as const }
    );
    return {
      dto: { accountId: acc.id, ref: project.ref, metrics },
      refreshFailed,
    };
  };

  return {
    async login() {
      return { user: LOCAL_USER };
    },
    async loginSecondFactor() {
      // Pas de connexion en local-first, donc pas de seconde étape.
      throw new ApiError(
        501,
        'local-unsupported',
        'Double authentification : réservée au serveur Miss Supaboss'
      );
    },
    async logout() {
      /* local : rien à invalider côté serveur */
    },
    async me() {
      return LOCAL_USER;
    },

    async listAccounts() {
      return state.accounts.map(toAccountDto);
    },
    async createAccount(input) {
      // Coffre recommandé mais optionnel : s'il est actif il doit être
      // déverrouillé ; sinon le PAT part en clair via `save()`.
      if (patVault.isEnabled() && !patVault.isUnlocked()) {
        throw new ApiError(
          400,
          'vault-required',
          'Déverrouillez le coffre avant d’ajouter un PAT'
        );
      }
      // Valide le PAT en interrogeant les organisations (échoue si invalide).
      let organizations;
      try {
        organizations = await client.listOrganizations(input.pat);
      } catch (e) {
        const { message } = classifySyncError(e, 'PAT invalide');
        recordOp({
          action: 'account.create',
          accountId: null,
          accountAlias: input.alias,
          projectRef: null,
          projectName: null,
          status: 'error',
          detail: message,
        });
        save();
        throw e instanceof ApiError
          ? e
          : new ApiError(422, 'pat-invalid', message);
      }
      const acc: RealAccount = {
        id: `acc-${crypto.randomUUID().slice(0, 8)}`,
        alias: input.alias,
        color: input.color,
        enabled: true,
        pat: input.pat,
        patHint: `sbp_…${input.pat.slice(-4)}`,
        createdAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        patExpiresAt: input.patExpiresAt ?? null,
      };
      if (patVault.isEnabled() && patVault.isUnlocked()) {
        acc.patEnc = await patVault.encrypt(input.pat);
      }
      state.accounts.push(acc);
      recordOp({
        action: 'account.create',
        accountId: acc.id,
        accountAlias: acc.alias,
        projectRef: null,
        projectName: null,
        status: 'ok',
        detail: `${organizations.length} org`,
      });
      save();
      return toAccountDto(acc);
    },
    async updateAccount(id, fields) {
      const acc = getAccount(id);
      if (fields.alias !== undefined) acc.alias = fields.alias;
      if (fields.color !== undefined) acc.color = fields.color;
      if (fields.enabled !== undefined) acc.enabled = fields.enabled;
      if (fields.patExpiresAt !== undefined)
        acc.patExpiresAt = fields.patExpiresAt;
      if (fields.pat !== undefined) {
        if (patVault.isEnabled() && !patVault.isUnlocked()) {
          throw new ApiError(
            400,
            'vault-required',
            'Coffre verrouillé : déverrouillez avant de changer le PAT'
          );
        }
        acc.pat = fields.pat;
        acc.patHint = `sbp_…${fields.pat.slice(-4)}`;
        if (patVault.isEnabled() && patVault.isUnlocked()) {
          acc.patEnc = await patVault.encrypt(fields.pat);
        } else {
          acc.patEnc = undefined;
        }
      }
      cache.delete(id);
      recordOp({
        action: 'account.update',
        accountId: id,
        accountAlias: acc.alias,
        projectRef: null,
        projectName: null,
        status: 'ok',
        detail: Object.keys(fields).join(', '),
      });
      save();
      return toAccountDto(acc);
    },
    async deleteAccount(id) {
      const acc = getAccount(id);
      state.accounts = state.accounts.filter(a => a.id !== id);
      for (const key of Object.keys(state.meta)) {
        if (key.startsWith(`${id}:`)) delete state.meta[key];
      }
      cache.delete(id);
      recordOp({
        action: 'account.delete',
        accountId: id,
        accountAlias: acc.alias,
        projectRef: null,
        projectName: null,
        status: 'ok',
        detail: null,
      });
      save();
    },
    async testAccount(id) {
      const acc = getAccount(id);
      try {
        const { orgs, projects } = await loadAccountFleet(acc, true);
        recordOp({
          action: 'account.test',
          accountId: id,
          accountAlias: acc.alias,
          projectRef: null,
          projectName: null,
          status: 'ok',
          detail: `${orgs.length} org, ${projects.length} projets`,
        });
        save();
        return { ok: true, organizations: orgs, projects: projects.length };
      } catch (e) {
        const message = e instanceof ApiError ? e.message : 'Test impossible';
        acc.lastError = message;
        recordOp({
          action: 'account.test',
          accountId: id,
          accountAlias: acc.alias,
          projectRef: null,
          projectName: null,
          status: 'error',
          detail: message,
        });
        save();
        throw e instanceof ApiError
          ? e
          : new ApiError(502, 'test-failed', message);
      }
    },
    async exportAccounts(passphrase) {
      if (!patVault.isEnabled() || !patVault.isUnlocked()) {
        throw new ApiError(
          400,
          'vault-required',
          'Déverrouillez le coffre avant d’exporter'
        );
      }
      const accounts = state.accounts
        .filter(a => a.pat.length > 0)
        .map(a => ({
          alias: a.alias,
          color: a.color,
          pat: a.pat,
          patExpiresAt: a.patExpiresAt ?? null,
        }));
      if (accounts.length === 0) {
        throw new ApiError(400, 'empty', 'Aucun compte à exporter');
      }
      try {
        const blob = await sealPortableAccounts(accounts, passphrase);
        return { blob, count: accounts.length };
      } catch {
        throw new ApiError(400, 'export-failed', 'Export impossible');
      }
    },
    async importAccounts(passphrase, blob) {
      if (!patVault.isEnabled() || !patVault.isUnlocked()) {
        throw new ApiError(
          400,
          'vault-required',
          'Déverrouillez le coffre avant d’importer'
        );
      }
      let incoming;
      try {
        incoming = await openPortableAccounts(blob, passphrase);
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'format';
        throw new ApiError(
          400,
          reason === 'passphrase' ? 'bad-passphrase' : 'bad-blob',
          reason === 'passphrase'
            ? 'Phrase d’export incorrecte'
            : 'Blob d’export invalide'
        );
      }
      let imported = 0;
      for (const row of incoming) {
        if (state.accounts.some(a => a.alias === row.alias)) continue;
        try {
          await this.createAccount({
            alias: row.alias,
            pat: row.pat,
            color: row.color,
            patExpiresAt: row.patExpiresAt,
          });
          imported += 1;
        } catch {
          // PAT mort / org inaccessible : on saute, on compte quand même total
        }
      }
      return { imported, total: incoming.length };
    },

    async getFleet(refresh) {
      const accounts = await Promise.all(
        state.accounts.map(async acc => {
          if (!acc.enabled) {
            return {
              account: toAccountDto(acc),
              organizations: [],
              projects: [],
              syncedAt: null,
            };
          }
          try {
            const { organizations, projects } = await loadAccountFleet(
              acc,
              refresh
            );
            return {
              account: toAccountDto(acc),
              organizations,
              projects,
              syncedAt: acc.lastSyncAt,
            };
          } catch (e) {
            acc.lastError =
              e instanceof ApiError ? e.message : 'Synchro échouée';
            const stale = cache.get(acc.id);
            return {
              account: toAccountDto(acc),
              organizations: [],
              projects: stale?.fleet ?? [],
              syncedAt: stale ? new Date(stale.at).toISOString() : null,
            };
          }
        })
      );
      save();
      return { accounts, generatedAt: new Date().toISOString() };
    },
    async getFleetMetrics(refresh) {
      // Collecte parallèle : tous les comptes activés de front, et tous les
      // projets d'un compte de front (au lieu d'une double boucle séquentielle
      // qui sérialisait chaque aller-retour proxy). L'ordre comptes→projets est
      // préservé (Promise.all conserve l'ordre des entrées).
      const perAccount = await Promise.all(
        state.accounts
          .filter(acc => acc.enabled)
          .map(async acc => {
            let live: ProjectDto[];
            try {
              live = (await loadAccountFleet(acc, false)).projects;
            } catch {
              live = cache.get(acc.id)?.fleet ?? [];
            }
            return Promise.all(
              live.map(p => collectProjectMetrics(acc, p, refresh))
            );
          })
      );
      const flat = perAccount.flat();
      save();
      return {
        projects: flat.map(r => r.dto),
        generatedAt: new Date().toISOString(),
        refreshErrors: flat.filter(r => r.refreshFailed).length,
      };
    },
    async getProject(accountId, ref, refresh) {
      const projects = await projectsOf(accountId, refresh);
      const p = projects.find(x => x.ref === ref);
      if (!p)
        throw new ApiError(
          404,
          'project-not-found',
          `Projet ${ref} introuvable`
        );
      return p;
    },
    async getProjectHealth(accountId, ref) {
      const acc = getAccount(accountId);
      if (!acc.pat) {
        throw new ApiError(401, 'vault-locked', 'Coffre verrouillé');
      }
      return client.getProjectHealth(acc.pat, ref);
    },
    async assessRestore(accountId, ref) {
      const lite = toLite(await projectsOf(accountId, false));
      return toRestoreAssessmentDto(assessRestore(lite, ref));
    },
    async pingKeepAlive(accountId, ref) {
      const acc = getAccount(accountId);
      if (!acc.pat) {
        throw new ApiError(400, 'vault-locked', 'Coffre verrouillé');
      }
      // Collecte SQL read-only : réveille le compute Free sans workflow externe.
      const result = await client.collectMetrics(acc.pat, ref);
      if (result.failed) {
        throw new ApiError(
          502,
          'keepalive-failed',
          'Keep-alive impossible (réseau ou PAT)'
        );
      }
      recordOp({
        action: 'project.meta',
        accountId,
        accountAlias: acc.alias,
        projectRef: ref,
        projectName: null,
        status: 'ok',
        detail: 'keepalive ping',
      });
      save();
    },

    async pauseProject(accountId, ref) {
      const acc = getAccount(accountId);
      const projects = await projectsOf(accountId, false);
      const p = projects.find(x => x.ref === ref);
      const pauseFailure = validatePause(p, ref);
      if (pauseFailure) {
        throw new ApiError(
          pauseFailure.status,
          pauseFailure.code,
          pauseFailure.message
        );
      }
      const project = p!;
      await client.pause(acc.pat, ref);
      cache.delete(accountId);
      recordOp({
        action: 'project.pause',
        accountId,
        accountAlias: acc.alias,
        projectRef: ref,
        projectName: project.name,
        status: 'ok',
        detail: null,
      });
      save();
    },
    async restoreProject(accountId, ref, options) {
      const acc = getAccount(accountId);
      const projects = await projectsOf(accountId, false);
      const lite = toLite(projects);
      const restoreFailure = validateRestore(lite, ref, options);
      if (restoreFailure) {
        throw new ApiError(
          restoreFailure.status,
          restoreFailure.code,
          restoreFailure.message,
          restoreFailure.assessment
        );
      }
      const target = projects.find(x => x.ref === ref)!;
      const refsToPause = pausesBeforeRestore(
        projects,
        options.pauseFirst,
        ref
      );
      for (const refToPause of refsToPause) {
        const toPause = projects.find(x => x.ref === refToPause)!;
        await client.pause(acc.pat, refToPause);
        recordOp({
          action: 'project.pause',
          accountId,
          accountAlias: acc.alias,
          projectRef: refToPause,
          projectName: toPause.name,
          status: 'ok',
          detail: 'Pause préalable (préparation de démo)',
        });
      }
      await client.restore(acc.pat, ref);
      cache.delete(accountId);
      recordOp({
        action: 'project.restore',
        accountId,
        accountAlias: acc.alias,
        projectRef: ref,
        projectName: target.name,
        status: 'ok',
        detail: null,
      });
      save();
    },
    async updateProjectMeta(accountId, ref, fields) {
      const key = metaKey(accountId, ref);
      const meta: RealMeta = state.meta[key] ?? {
        tags: [],
        favorite: false,
        demoFrequent: false,
        notes: '',
        lastSeenActiveAt: null,
        pausedAt: null,
      };
      if (fields.tags !== undefined) meta.tags = fields.tags;
      if (fields.favorite !== undefined) meta.favorite = fields.favorite;
      if (fields.demoFrequent !== undefined)
        meta.demoFrequent = fields.demoFrequent;
      if (fields.notes !== undefined) meta.notes = fields.notes;
      if (fields.keepAliveOptIn !== undefined)
        meta.keepAliveOptIn = fields.keepAliveOptIn;
      state.meta[key] = meta;
      // Réécrit le cache courant pour refléter la méta sans re-fetch.
      cache.delete(accountId);
      save();
    },

    async listOperations(limit = 100) {
      return state.operations.slice(0, limit);
    },
    async getSettings() {
      return state.settings;
    },
    async putSettings(settings) {
      state.settings = settings;
      save();
      return settings;
    },

    vault: {
      isEnabled: () => patVault.isEnabled(),
      isUnlocked: () => patVault.isUnlocked(),
      async enable(passphrase) {
        await patVault.enable(passphrase);
        // Chiffre les PAT déjà présents (encore en clair en mémoire).
        for (const a of state.accounts) {
          a.patEnc = await patVault.encrypt(a.pat);
        }
        save();
      },
      async disable() {
        // Nécessite une session déverrouillée : `pat` est en mémoire → on
        // repasse en persistance claire et on retire les blobs chiffrés.
        for (const a of state.accounts) a.patEnc = undefined;
        patVault.disable();
        save();
      },
      async unlock(passphrase) {
        const ok = await patVault.unlock(passphrase);
        if (!ok) return false;
        for (const a of state.accounts) {
          if (a.patEnc) a.pat = await patVault.decrypt(a.patEnc);
        }
        return true;
      },
      lock() {
        patVault.lock();
        // Oublie aussi le clair en mémoire.
        for (const a of state.accounts) a.pat = '';
      },
      reset() {
        patVault.disable();
        // Comptes chiffrés irrécupérables → on repart propre.
        state.accounts = [];
        state.meta = {};
        cache.clear();
        metricsCache.clear();
        save();
      },
    },
  };
}
