/**
 * API mock (VITE_MOCK=1) : démo complète sans backend ni secret — utilisée
 * par GitHub Pages et `npm run dev:mock`. Mêmes contrats et MÊMES garde-fous
 * (shared/guards) que le serveur ; état persisté en localStorage pour que la
 * démo survive aux rechargements. Latence simulée pour des états de
 * chargement réalistes.
 */
import {
  DEFAULT_SETTINGS,
  type AccountDto,
  type FleetDto,
  type OperationDto,
  type ProjectDto,
  type SettingsDto,
  type UserDto,
} from '../../shared/contracts.ts';
import { estimateRestoreDeadline } from '../../shared/guards.ts';
import {
  assessRestore,
  pausesBeforeRestore,
  toRestoreAssessmentDto,
  validatePause,
  validateRestore,
} from '../../shared/fleet/index.ts';
import {
  FREE_PLAN_QUOTAS,
  MB,
  unavailableMetric,
  type MetricValue,
} from '../../shared/quotas.ts';
import type { SupabaseProjectStatus } from '../../shared/status.ts';
import { ApiError, type Api } from '../api/types.ts';
import {
  MOCK_STORAGE_KEY as STORAGE_KEY,
  isDemoSeed,
} from '../api/demoMode.ts';

const DEMO_USER: UserDto = {
  id: 'demo',
  email: 'demo@miss-supaboss.app',
  role: 'admin',
};

interface MockProject {
  accountId: string;
  ref: string;
  name: string;
  region: string;
  organizationSlug: string;
  organizationName: string;
  status: SupabaseProjectStatus;
  createdAt: string;
  tags: string[];
  favorite: boolean;
  demoFrequent: boolean;
  notes: string;
  lastSeenActiveAt: string | null;
  pausedAt: string | null;
  /** Base de métriques (MB / utilisateurs) pour des valeurs stables. */
  seed: number;
}

interface MockState {
  accounts: AccountDto[];
  projects: MockProject[];
  operations: OperationDto[];
  settings: SettingsDto;
  opSeq: number;
}

const DAY = 24 * 3600 * 1000;
const iso = (deltaMs: number): string =>
  new Date(Date.now() + deltaMs).toISOString();

function mkAccount(
  id: string,
  alias: string,
  color: string,
  hint: string
): AccountDto {
  return {
    id,
    alias,
    color,
    enabled: true,
    patHint: hint,
    createdAt: iso(-40 * DAY),
    lastSyncAt: iso(-60_000),
    lastError: null,
  };
}

function mkProject(
  accountId: string,
  org: [string, string],
  ref: string,
  name: string,
  status: SupabaseProjectStatus,
  seed: number,
  extra: Partial<MockProject> = {}
): MockProject {
  return {
    accountId,
    ref,
    name,
    region: 'eu-west-3',
    organizationSlug: org[0],
    organizationName: org[1],
    status,
    createdAt: iso(-90 * DAY),
    tags: ['poc'],
    favorite: false,
    demoFrequent: false,
    notes: '',
    lastSeenActiveAt: status === 'INACTIVE' ? iso(-12 * DAY) : iso(-60_000),
    pausedAt: status === 'INACTIVE' ? iso(-12 * DAY) : null,
    seed,
    ...extra,
  };
}

/** Org + projets simulés pour un compte AJOUTÉ (le déploiement Pages n'a pas
 *  de backend pour interroger Supabase — données d'exemple locales). */
function demoProjectsForAccount(
  accountId: string,
  alias: string
): MockProject[] {
  const org: [string, string] = [`org-${accountId}`, alias];
  return [
    mkProject(accountId, org, `${accountId}-api`, 'API', 'ACTIVE_HEALTHY', 8, {
      tags: ['prod'],
      favorite: true,
    }),
    mkProject(
      accountId,
      org,
      `${accountId}-web`,
      'Web app',
      'ACTIVE_HEALTHY',
      4
    ),
    mkProject(
      accountId,
      org,
      `${accountId}-staging`,
      'Staging',
      'INACTIVE',
      2,
      {
        tags: ['staging'],
        lastSeenActiveAt: iso(-20 * DAY),
        pausedAt: iso(-20 * DAY),
      }
    ),
  ];
}

function seedState(): MockState {
  const labOrg: [string, string] = ['poc-lab', 'POC Lab'];
  const cliOrg: [string, string] = ['demo-clients', 'Démos clients'];
  return {
    accounts: [
      mkAccount('acc-lab', 'Lab POC interne', '#3ecf8e', 'sbp_…f3a1'),
      mkAccount('acc-cli', 'Démos clients', '#38bdf8', 'sbp_…77c2'),
    ],
    projects: [
      mkProject('acc-lab', labOrg, 'crm-poc', 'CRM POC', 'ACTIVE_HEALTHY', 6, {
        tags: ['poc', 'demo'],
        demoFrequent: true,
      }),
      // seed 49 → dbSize ≈ 361 MB / 500 MB (~72 %) : illustre le seuil warn.
      mkProject(
        'acc-lab',
        labOrg,
        'rag-ia-demo',
        'RAG IA Démo',
        'ACTIVE_HEALTHY',
        49,
        {
          tags: ['demo', 'critique-demo'],
          favorite: true,
        }
      ),
      mkProject(
        'acc-lab',
        labOrg,
        'hackathon-2026',
        'Hackathon 2026',
        'INACTIVE',
        3
      ),
      mkProject(
        'acc-lab',
        labOrg,
        'survey-archive',
        'Sondage (archive)',
        'INACTIVE',
        2,
        {
          tags: ['archive'],
          lastSeenActiveAt: iso(-85 * DAY),
          pausedAt: iso(-85 * DAY),
        }
      ),
      mkProject(
        'acc-cli',
        cliOrg,
        'pitch-retail',
        'Pitch Retail',
        'ACTIVE_HEALTHY',
        9,
        {
          tags: ['demo'],
          favorite: true,
          demoFrequent: true,
        }
      ),
      // En pause + démo fréquente → alimente « Prêts à démarrer maintenant ».
      mkProject(
        'acc-cli',
        cliOrg,
        'mvp-logistique',
        'MVP Logistique',
        'INACTIVE',
        5,
        {
          tags: ['demo'],
          demoFrequent: true,
          lastSeenActiveAt: iso(-30 * DAY),
          pausedAt: iso(-30 * DAY),
        }
      ),
    ],
    operations: [
      {
        id: 1,
        ts: iso(-2 * DAY),
        userEmail: DEMO_USER.email,
        action: 'project.pause',
        accountId: 'acc-lab',
        accountAlias: 'Lab POC interne',
        projectRef: 'hackathon-2026',
        projectName: 'Hackathon 2026',
        status: 'ok',
        detail: null,
      },
    ],
    settings: DEFAULT_SETTINGS,
    opSeq: 1,
  };
}

/** État local VIDE : l'utilisateur saisit ses propres données (démo OFF). */
function emptyState(): MockState {
  return {
    accounts: [],
    projects: [],
    operations: [],
    settings: DEFAULT_SETTINGS,
    opSeq: 0,
  };
}

function loadState(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    // état corrompu → on repart du défaut
  }
  // Aucun état persisté : données d'exemple (démo) OU store local vide.
  return isDemoSeed() ? seedState() : emptyState();
}

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export function createMockApi(): Api {
  const state = loadState();

  const save = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // stockage plein/indisponible : la démo continue en mémoire
    }
  };

  const account = (id: string): AccountDto => {
    const a = state.accounts.find(x => x.id === id);
    if (!a) throw new ApiError(404, 'account-not-found', 'Compte introuvable');
    return a;
  };
  const project = (accountId: string, ref: string): MockProject => {
    const p = state.projects.find(
      x => x.accountId === accountId && x.ref === ref
    );
    if (!p)
      throw new ApiError(404, 'project-not-found', `Projet ${ref} introuvable`);
    return p;
  };

  const recordOp = (
    op: Omit<OperationDto, 'id' | 'ts' | 'userEmail'>
  ): void => {
    state.opSeq += 1;
    state.operations.unshift({
      ...op,
      id: state.opSeq,
      ts: new Date().toISOString(),
      userEmail: DEMO_USER.email,
    });
    state.operations = state.operations.slice(0, 200);
  };

  const toDto = (p: MockProject): ProjectDto => ({
    accountId: p.accountId,
    ref: p.ref,
    name: p.name,
    region: p.region,
    organizationSlug: p.organizationSlug,
    organizationName: p.organizationName,
    status: p.status,
    createdAt: p.createdAt,
    meta: {
      tags: p.tags,
      favorite: p.favorite,
      demoFrequent: p.demoFrequent,
      notes: p.notes,
      lastSeenActiveAt: p.lastSeenActiveAt,
      pausedAt: p.pausedAt,
      restoreDeadline: estimateRestoreDeadline(
        p.pausedAt,
        state.settings.restoreWindowDays
      ),
    },
  });

  const toLite = (projects: MockProject[]) =>
    projects.map(p => ({
      ref: p.ref,
      name: p.name,
      status: p.status,
      favorite: p.favorite,
      demoFrequent: p.demoFrequent,
      tags: p.tags,
      lastSeenActiveAt: p.lastSeenActiveAt,
      dto: toDto(p),
    }));

  const transition = (
    p: MockProject,
    via: SupabaseProjectStatus,
    to: SupabaseProjectStatus,
    ms: number
  ): void => {
    p.status = via;
    save();
    setTimeout(() => {
      p.status = to;
      if (to === 'ACTIVE_HEALTHY') {
        p.lastSeenActiveAt = new Date().toISOString();
        p.pausedAt = null;
      }
      if (to === 'INACTIVE') p.pausedAt = new Date().toISOString();
      save();
    }, ms);
  };

  const buildFleet = (): FleetDto => ({
    accounts: state.accounts.map(a => ({
      account: a,
      organizations: [
        ...new Map(
          state.projects
            .filter(p => p.accountId === a.id)
            .map(p => [
              p.organizationSlug,
              { slug: p.organizationSlug, name: p.organizationName },
            ])
        ).values(),
      ],
      projects: a.enabled
        ? state.projects.filter(p => p.accountId === a.id).map(toDto)
        : [],
      syncedAt: a.enabled ? new Date().toISOString() : null,
    })),
    generatedAt: new Date().toISOString(),
  });

  const metricsFor = (p: MockProject): MetricValue[] => {
    const paused = p.status === 'INACTIVE';
    const at = paused ? (p.pausedAt ?? p.createdAt) : new Date().toISOString();
    const state_ = paused ? 'stale' : 'measured';
    const v = (n: number): number => Math.round(n);
    return [
      unavailableMetric('egress'), // fidèle au réel : aucune source documentée
      {
        kind: 'dbSize',
        state: state_,
        value: v((18 + p.seed * 7) * MB),
        quota: FREE_PLAN_QUOTAS.dbSize,
        measuredAt: at,
      },
      {
        kind: 'mau',
        state: paused ? 'stale' : 'estimated',
        value: p.seed,
        quota: FREE_PLAN_QUOTAS.mau,
        measuredAt: at,
      },
      {
        kind: 'storage',
        state: state_,
        value: v((1.2 + p.seed * 1.4) * MB),
        quota: FREE_PLAN_QUOTAS.storage,
        measuredAt: at,
      },
    ];
  };

  return {
    async login() {
      await sleep(250);
      return DEMO_USER;
    },
    async logout() {
      await sleep(80);
    },
    async me() {
      await sleep(120);
      return DEMO_USER;
    },

    async listAccounts() {
      await sleep(150);
      return state.accounts;
    },
    async createAccount(input) {
      await sleep(600);
      const acc: AccountDto = {
        id: `acc-${Math.random().toString(36).slice(2, 8)}`,
        alias: input.alias,
        color: input.color,
        enabled: true,
        patHint: `sbp_…${input.pat.slice(-4)}`,
        createdAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      };
      state.accounts.push(acc);
      // Démo locale : on simule l'org + les projets visibles par ce PAT, pour
      // que « Tester » et la flotte ne renvoient pas 0 projet (pas de backend).
      const demoProjects = demoProjectsForAccount(acc.id, acc.alias);
      state.projects.push(...demoProjects);
      recordOp({
        action: 'account.create',
        accountId: acc.id,
        accountAlias: acc.alias,
        projectRef: null,
        projectName: null,
        status: 'ok',
        detail: `1 org, ${demoProjects.length} projets (démo)`,
      });
      save();
      return acc;
    },
    async updateAccount(id, fields) {
      await sleep(200);
      const acc = account(id);
      if (fields.alias !== undefined) acc.alias = fields.alias;
      if (fields.color !== undefined) acc.color = fields.color;
      if (fields.enabled !== undefined) acc.enabled = fields.enabled;
      if (fields.pat !== undefined)
        acc.patHint = `sbp_…${fields.pat.slice(-4)}`;
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
      return acc;
    },
    async deleteAccount(id) {
      await sleep(200);
      const acc = account(id);
      state.accounts = state.accounts.filter(a => a.id !== id);
      state.projects = state.projects.filter(p => p.accountId !== id);
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
      await sleep(700);
      const acc = account(id);
      const accountProjects = state.projects.filter(p => p.accountId === id);
      // Noms d'organisations distincts, dérivés des projets du compte.
      const organizations = [
        ...new Set(accountProjects.map(p => p.organizationName)),
      ];
      const projects = accountProjects.length;
      recordOp({
        action: 'account.test',
        accountId: id,
        accountAlias: acc.alias,
        projectRef: null,
        projectName: null,
        status: 'ok',
        detail: `${organizations.length} org, ${projects} projets`,
      });
      save();
      return { ok: true, organizations, projects };
    },
    async exportAccounts() {
      await sleep(300);
      recordOp({
        action: 'config.export',
        accountId: null,
        accountAlias: null,
        projectRef: null,
        projectName: null,
        status: 'ok',
        detail: `${state.accounts.length} compte(s) — démo`,
      });
      save();
      return {
        blob: 'supaboss-export-v1:demo:demo:demo:ZGVtbw==',
        count: state.accounts.length,
      };
    },
    async importAccounts() {
      await sleep(300);
      throw new ApiError(
        422,
        'mock',
        'Import indisponible en mode démo (aucun vrai secret ici)'
      );
    },

    async getFleet() {
      await sleep(350);
      return buildFleet();
    },
    async getFleetMetrics() {
      await sleep(450);
      return {
        projects: state.projects
          .filter(p => account(p.accountId).enabled)
          .map(p => ({
            accountId: p.accountId,
            ref: p.ref,
            metrics: metricsFor(p),
          })),
        generatedAt: new Date().toISOString(),
      };
    },
    async getProject(accountId, ref) {
      await sleep(200);
      return toDto(project(accountId, ref));
    },
    async assessRestore(accountId, ref) {
      await sleep(250);
      const lite = toLite(
        state.projects.filter(p => p.accountId === accountId)
      );
      return toRestoreAssessmentDto(assessRestore(lite, ref));
    },
    async pauseProject(accountId, ref) {
      await sleep(500);
      const p = project(accountId, ref);
      const pauseFailure = validatePause(p, ref);
      if (pauseFailure) {
        throw new ApiError(
          pauseFailure.status,
          pauseFailure.code,
          pauseFailure.message
        );
      }
      transition(p, 'PAUSING', 'INACTIVE', 5000);
      recordOp({
        action: 'project.pause',
        accountId,
        accountAlias: account(accountId).alias,
        projectRef: ref,
        projectName: p.name,
        status: 'ok',
        detail: null,
      });
      save();
    },
    async restoreProject(accountId, ref, options) {
      await sleep(500);
      const all = state.projects.filter(p => p.accountId === accountId);
      const lite = toLite(all);
      const restoreFailure = validateRestore(lite, ref, options);
      if (restoreFailure) {
        throw new ApiError(
          restoreFailure.status,
          restoreFailure.code,
          restoreFailure.message,
          restoreFailure.assessment
        );
      }
      const refsToPause = pausesBeforeRestore(all, options.pauseFirst, ref);
      for (const refToPause of refsToPause) {
        const toPause = project(accountId, refToPause);
        transition(toPause, 'PAUSING', 'INACTIVE', 5000);
        recordOp({
          action: 'project.pause',
          accountId,
          accountAlias: account(accountId).alias,
          projectRef: refToPause,
          projectName: toPause.name,
          status: 'ok',
          detail: 'Pause préalable (préparation de démo)',
        });
      }
      const target = project(accountId, ref);
      transition(target, 'RESTORING', 'ACTIVE_HEALTHY', 9000);
      recordOp({
        action: 'project.restore',
        accountId,
        accountAlias: account(accountId).alias,
        projectRef: ref,
        projectName: target.name,
        status: 'ok',
        detail: null,
      });
      save();
    },
    async updateProjectMeta(accountId, ref, fields) {
      await sleep(150);
      const p = project(accountId, ref);
      if (fields.tags !== undefined) p.tags = fields.tags;
      if (fields.favorite !== undefined) p.favorite = fields.favorite;
      if (fields.demoFrequent !== undefined)
        p.demoFrequent = fields.demoFrequent;
      if (fields.notes !== undefined) p.notes = fields.notes;
      save();
    },

    async listOperations(limit = 100) {
      await sleep(200);
      return state.operations.slice(0, limit);
    },
    async getSettings() {
      await sleep(100);
      return state.settings;
    },
    async putSettings(settings) {
      await sleep(150);
      state.settings = settings;
      save();
      return settings;
    },
  };
}
