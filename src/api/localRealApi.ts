/**
 * API « réelle local-first » : la PWA (GitHub Pages, sans backend) interroge
 * directement la Supabase Management API via le proxy CORS
 * (cf. proxy/ — Cloudflare Worker). Les comptes, le PAT et les
 * métadonnées (tags/favoris/notes/observations) sont stockés EN LOCAL
 * (localStorage) sur l'appareil — le PAT n'est transmis qu'au proxy.
 *
 * Différences avec le serveur Fastify : pas de chiffrement au repos (le PAT
 * vit en clair dans localStorage, comme tout dashboard client-side), pas de
 * RBAC (l'utilisateur est admin de sa propre instance), et les métriques de
 * quota ne sont pas (encore) collectées → « non disponible ».
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
  evaluateRestore,
  estimateRestoreDeadline,
} from '../../shared/guards.ts';
import { isPausable, isRestorable } from '../../shared/status.ts';
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

const LOCAL_USER: UserDto = {
  id: 'local',
  email: 'local@miss-supaboss.app',
  role: 'admin',
};

/** État réel persisté localement (séparé des fixtures de démo). */
export const REAL_STORAGE_KEY = 'miss-supaboss-real-v1';

const FLEET_TTL_MS = 15_000;
const METRICS_TTL_MS = 5 * 60_000;

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
}

interface RealMeta {
  tags: string[];
  favorite: boolean;
  demoFrequent: boolean;
  notes: string;
  lastSeenActiveAt: string | null;
  pausedAt: string | null;
}

interface RealState {
  accounts: RealAccount[];
  /** Clé `${accountId}:${ref}` → métadonnées locales. */
  meta: Record<string, RealMeta>;
  operations: OperationDto[];
  settings: SettingsDto;
  opSeq: number;
}

function emptyState(): RealState {
  return {
    accounts: [],
    meta: {},
    operations: [],
    settings: DEFAULT_SETTINGS,
    opSeq: 0,
  };
}

function loadState(): RealState {
  try {
    const raw = localStorage.getItem(REAL_STORAGE_KEY);
    if (raw) {
      const parsed = { ...emptyState(), ...(JSON.parse(raw) as RealState) };
      // Coffre activé : le PAT en clair n'est pas persisté → `pat` absent
      // jusqu'au déverrouillage. On garantit une chaîne (jamais undefined).
      parsed.accounts = parsed.accounts.map(a => ({ ...a, pat: a.pat ?? '' }));
      return parsed;
    }
  } catch {
    // état corrompu → repart vide
  }
  return emptyState();
}

const ACTIVE = new Set(['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY']);
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
  };
}

export function createLocalRealApi(proxyBase: string): Api {
  const state = loadState();
  const client = new BrowserManagementClient(proxyBase);
  const cache = new Map<
    string,
    { fleet: ProjectDto[]; orgs: string[]; at: number }
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
    const meta: RealMeta = state.meta[key] ?? {
      tags: [],
      favorite: false,
      demoFrequent: false,
      notes: '',
      lastSeenActiveAt: null,
      pausedAt: null,
    };
    const now = new Date().toISOString();
    if (ACTIVE.has(raw.status)) {
      meta.lastSeenActiveAt = now;
      meta.pausedAt = null;
    } else if (raw.status === 'INACTIVE') {
      meta.pausedAt = meta.pausedAt ?? now;
    }
    state.meta[key] = meta;
    return meta;
  };

  const toDto = (
    accountId: string,
    raw: RawProject,
    orgName: string
  ): ProjectDto => {
    const meta = observe(accountId, raw);
    return {
      accountId,
      ref: raw.ref,
      name: raw.name,
      region: raw.region,
      organizationSlug: raw.organizationSlug,
      organizationName: orgName,
      status: raw.status,
      createdAt: raw.createdAt,
      meta: {
        tags: meta.tags,
        favorite: meta.favorite,
        demoFrequent: meta.demoFrequent,
        notes: meta.notes,
        lastSeenActiveAt: meta.lastSeenActiveAt,
        pausedAt: meta.pausedAt,
        restoreDeadline: estimateRestoreDeadline(
          meta.pausedAt,
          state.settings.restoreWindowDays
        ),
      },
    };
  };

  /** Charge orgs + projets live d'un compte (PAT), construit les ProjectDto. */
  const loadAccountFleet = async (
    acc: RealAccount,
    refresh: boolean
  ): Promise<{ orgs: string[]; projects: ProjectDto[] }> => {
    const cached = cache.get(acc.id);
    if (!refresh && cached && Date.now() - cached.at < FLEET_TTL_MS) {
      return { orgs: cached.orgs, projects: cached.fleet };
    }
    const [organizations, rawProjects] = await Promise.all([
      client.listOrganizations(acc.pat),
      client.listProjects(acc.pat),
    ]);
    const orgNames = new Map(organizations.map(o => [o.slug, o.name]));
    const projects = rawProjects.map(raw =>
      toDto(
        acc.id,
        raw,
        orgNames.get(raw.organizationSlug) ?? raw.organizationSlug
      )
    );
    const orgs = organizations.map(o => o.name);
    cache.set(acc.id, { fleet: projects, orgs, at: Date.now() });
    acc.lastSyncAt = new Date().toISOString();
    acc.lastError = null;
    return { orgs, projects };
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
    const isActive = ACTIVE.has(project.status);
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
          metricsCache.set(key, {
            at: Date.now(),
            metrics: [
              unavailableMetric('egress'),
              buildMetric('dbSize', m.dbSizeBytes, 'measured', at),
              buildMetric('mau', m.mau, 'estimated', at),
              buildMetric('storage', m.storageBytes, 'measured', at),
            ],
          });
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
      return LOCAL_USER;
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
      // Valide le PAT en interrogeant les organisations (échoue si invalide).
      let organizations;
      try {
        organizations = await client.listOrganizations(input.pat);
      } catch (e) {
        const message = e instanceof ApiError ? e.message : 'PAT invalide';
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
        id: `acc-${Math.random().toString(36).slice(2, 8)}`,
        alias: input.alias,
        color: input.color,
        enabled: true,
        pat: input.pat,
        patHint: `sbp_…${input.pat.slice(-4)}`,
        createdAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      };
      // Coffre activé : on chiffre tout de suite (la session est déverrouillée).
      if (patVault.isEnabled()) acc.patEnc = await patVault.encrypt(input.pat);
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
      if (fields.pat !== undefined) {
        acc.pat = fields.pat;
        acc.patHint = `sbp_…${fields.pat.slice(-4)}`;
        acc.patEnc = patVault.isEnabled()
          ? await patVault.encrypt(fields.pat)
          : undefined;
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
    async exportAccounts() {
      throw new ApiError(
        501,
        'local-unsupported',
        'Export/import chiffré indisponible en mode local'
      );
    },
    async importAccounts() {
      throw new ApiError(
        501,
        'local-unsupported',
        'Export/import chiffré indisponible en mode local'
      );
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
            const { projects } = await loadAccountFleet(acc, refresh);
            const organizations = [
              ...new Map(
                projects.map(p => [
                  p.organizationSlug,
                  { slug: p.organizationSlug, name: p.organizationName },
                ])
              ).values(),
            ];
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
    async assessRestore(accountId, ref) {
      const lite = toLite(await projectsOf(accountId, false));
      const a = evaluateRestore(lite, ref);
      return {
        allowed: a.allowed,
        reason: a.reason,
        activeCount: a.activeCount,
        limit: a.limit,
        suggestions: a.suggestions.map(s => s.dto),
      };
    },
    async pauseProject(accountId, ref) {
      const acc = getAccount(accountId);
      const projects = await projectsOf(accountId, false);
      const p = projects.find(x => x.ref === ref);
      if (!p)
        throw new ApiError(
          404,
          'project-not-found',
          `Projet ${ref} introuvable`
        );
      if (!isPausable(p.status)) {
        throw new ApiError(
          409,
          'not-pausable',
          `« ${p.name} » n'est pas actif`
        );
      }
      await client.pause(acc.pat, ref);
      cache.delete(accountId);
      recordOp({
        action: 'project.pause',
        accountId,
        accountAlias: acc.alias,
        projectRef: ref,
        projectName: p.name,
        status: 'ok',
        detail: null,
      });
      save();
    },
    async restoreProject(accountId, ref, options) {
      const acc = getAccount(accountId);
      const projects = await projectsOf(accountId, false);
      const projected = toLite(projects).map(l =>
        options.pauseFirst.includes(l.ref) && l.ref !== ref
          ? { ...l, status: 'INACTIVE' as const }
          : l
      );
      const a = evaluateRestore(projected, ref);
      if (!a.allowed && a.reason !== 'limit-reached') {
        throw new ApiError(409, a.reason, 'Restauration impossible', {
          ...a,
          suggestions: a.suggestions.map(s => s.dto),
        });
      }
      if (!a.allowed && !options.force) {
        throw new ApiError(
          409,
          'limit-reached',
          `Limite Free atteinte (${a.activeCount}/${a.limit})`,
          { ...a, suggestions: a.suggestions.map(s => s.dto) }
        );
      }
      const target = projects.find(x => x.ref === ref);
      if (!target || !isRestorable(target.status)) {
        throw new ApiError(
          409,
          'not-restorable',
          `« ${target?.name ?? ref} » n'est pas en pause`
        );
      }
      for (const refToPause of options.pauseFirst) {
        if (refToPause === ref) continue;
        const toPause = projects.find(x => x.ref === refToPause);
        if (toPause && isPausable(toPause.status)) {
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
