/**
 * Service de flotte : orchestre Store (persistance), SupabaseProvider
 * (Management API ou mock) et garde-fous métier partagés.
 * Toute action est journalisée dans `operations` (audit).
 */
import {
  evaluateRestore,
  estimateRestoreDeadline,
  type ProjectLite,
} from '../../shared/guards.ts';
import { isPausable } from '../../shared/status.ts';
import {
  FREE_PLAN_QUOTAS,
  unavailableMetric,
  type MetricValue,
} from '../../shared/quotas.ts';
import type {
  AccountDto,
  AccountFleetDto,
  FleetDto,
  FleetMetricsDto,
  ProjectDto,
  ProjectMetricsDto,
  RestoreAssessmentDto,
} from '../../shared/contracts.ts';
import { openSecret } from './crypto.ts';
import type { Store } from './db.ts';
import type { SupabaseProvider } from './supabase/provider.ts';

/** Erreur métier porteuse d'un statut HTTP et d'un éventuel assessment. */
export class FleetError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly assessment?: RestoreAssessmentDto;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    assessment?: RestoreAssessmentDto
  ) {
    super(message);
    this.name = 'FleetError';
    this.statusCode = statusCode;
    this.code = code;
    if (assessment) this.assessment = assessment;
  }
}

const FLEET_TTL_MS = 15_000;
const METRICS_TTL_MS = 5 * 60_000;

interface CacheEntry {
  fleet: AccountFleetDto;
  at: number;
}

type Lite = ProjectLite & { dto: ProjectDto };

export class FleetService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly store: Store;
  private readonly provider: SupabaseProvider;
  private readonly masterKey: string;

  constructor(store: Store, provider: SupabaseProvider, masterKey: string) {
    this.store = store;
    this.provider = provider;
    this.masterKey = masterKey;
  }

  /* ── Lecture flotte ─────────────────────────────────────────────────── */

  accountDto(id: string): AccountDto | null {
    const row = this.store.getAccount(id);
    return row ? toAccountDto(row) : null;
  }

  async getFleet(refresh: boolean): Promise<FleetDto> {
    const accounts = this.store.listAccounts();
    const result: AccountFleetDto[] = [];
    for (const account of accounts) {
      if (!account.enabled) {
        result.push({
          account: toAccountDto(account),
          organizations: [],
          projects: [],
          syncedAt: null,
        });
        continue;
      }
      result.push(await this.accountFleet(account.id, refresh));
    }
    return { accounts: result, generatedAt: new Date().toISOString() };
  }

  /** Flotte d'un compte, depuis le cache court sauf `refresh`. */
  async accountFleet(
    accountId: string,
    refresh: boolean
  ): Promise<AccountFleetDto> {
    const cached = this.cache.get(accountId);
    if (!refresh && cached && Date.now() - cached.at < FLEET_TTL_MS) {
      return cached.fleet;
    }
    const account = this.store.getAccount(accountId);
    if (!account) {
      throw new FleetError(404, 'account-not-found', 'Compte introuvable');
    }
    try {
      const pat = openSecret(account.patCipher, this.masterKey);
      const [organizations, rawProjects] = await Promise.all([
        this.provider.listOrganizations(account.id, pat),
        this.provider.listProjects(account.id, pat),
      ]);
      const orgNames = new Map(organizations.map(o => [o.slug, o.name]));
      const projects: ProjectDto[] = rawProjects.map(raw => {
        const meta = this.store.observeProject(account.id, raw.ref, raw.status);
        return {
          accountId: account.id,
          ref: raw.ref,
          name: raw.name,
          region: raw.region,
          organizationSlug: raw.organizationSlug,
          organizationName:
            orgNames.get(raw.organizationSlug) ?? raw.organizationSlug,
          status: raw.status,
          createdAt: raw.createdAt,
          meta: {
            tags: meta.tags,
            favorite: meta.favorite,
            demoFrequent: meta.demoFrequent,
            notes: meta.notes,
            lastSeenActiveAt: meta.lastSeenActiveAt,
            pausedAt: meta.pausedAt,
            restoreDeadline: estimateRestoreDeadline(meta.pausedAt),
          },
        };
      });
      this.store.setAccountSync(account.id, true);
      const fleet: AccountFleetDto = {
        account: toAccountDto({
          ...account,
          lastSyncAt: new Date().toISOString(),
          lastError: null,
        }),
        organizations,
        projects,
        syncedAt: new Date().toISOString(),
      };
      this.cache.set(account.id, { fleet, at: Date.now() });
      return fleet;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.setAccountSync(account.id, false, message);
      const stale = this.cache.get(account.id);
      return {
        account: toAccountDto({ ...account, lastError: message }),
        organizations: stale?.fleet.organizations ?? [],
        projects: stale?.fleet.projects ?? [],
        syncedAt: stale?.fleet.syncedAt ?? null,
      };
    }
  }

  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }

  /* ── Actions pause / restore ────────────────────────────────────────── */

  async pause(
    userEmail: string,
    accountId: string,
    ref: string
  ): Promise<{ operationId: number }> {
    const { account, project, pat } = await this.loadActionContext(
      accountId,
      ref
    );
    if (!isPausable(project.status)) {
      throw new FleetError(
        409,
        'not-pausable',
        `Le projet « ${project.name} » n'est pas actif (statut ${project.status})`
      );
    }
    const operationId = this.store.recordOperation({
      userEmail,
      action: 'project.pause',
      accountId,
      accountAlias: account.alias,
      projectRef: ref,
      projectName: project.name,
      status: 'pending',
    });
    try {
      await this.provider.pauseProject(account.id, pat, ref);
      this.store.observeProject(accountId, ref, 'PAUSING');
      this.store.markPausedByUs(accountId, ref);
      this.store.updateOperation(operationId, 'ok');
      this.invalidate(accountId);
      return { operationId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateOperation(operationId, 'error', message);
      throw new FleetError(502, 'pause-failed', message);
    }
  }

  /** Évaluation sans exécution (préparation de démo). */
  async assessRestore(
    accountId: string,
    ref: string
  ): Promise<RestoreAssessmentDto> {
    const fleet = await this.accountFleet(accountId, true);
    return toAssessmentDto(evaluateRestore(toLite(fleet.projects), ref));
  }

  async restore(
    userEmail: string,
    accountId: string,
    ref: string,
    options: { pauseFirst: string[]; force: boolean }
  ): Promise<{ operationId: number }> {
    const { account, pat } = await this.loadActionContext(accountId, ref);
    const fleet = await this.accountFleet(accountId, true);
    const lite = toLite(fleet.projects);

    // Simule l'effet des pauses demandées avant d'évaluer le garde-fou.
    const projected = lite.map(p =>
      options.pauseFirst.includes(p.ref) && p.ref !== ref
        ? { ...p, status: 'INACTIVE' as const }
        : p
    );
    const assessment = evaluateRestore(projected, ref);
    if (!assessment.allowed && assessment.reason !== 'limit-reached') {
      throw new FleetError(
        409,
        assessment.reason,
        'Restauration impossible',
        toAssessmentDto(assessment)
      );
    }
    if (!assessment.allowed && !options.force) {
      throw new FleetError(
        409,
        'limit-reached',
        `Limite Free atteinte (${assessment.activeCount}/${assessment.limit} projets actifs)`,
        toAssessmentDto(assessment)
      );
    }

    const target = fleet.projects.find(p => p.ref === ref);
    const operationId = this.store.recordOperation({
      userEmail,
      action: 'project.restore',
      accountId,
      accountAlias: account.alias,
      projectRef: ref,
      projectName: target?.name ?? ref,
      status: 'pending',
    });
    try {
      for (const toPause of options.pauseFirst) {
        if (toPause === ref) continue;
        await this.pause(userEmail, accountId, toPause);
      }
      await this.provider.restoreProject(account.id, pat, ref);
      this.store.observeProject(accountId, ref, 'RESTORING');
      this.store.updateOperation(operationId, 'ok');
      this.invalidate(accountId);
      return { operationId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateOperation(operationId, 'error', message);
      if (error instanceof FleetError) throw error;
      throw new FleetError(502, 'restore-failed', message);
    }
  }

  /* ── Connectivité / test d'un PAT ───────────────────────────────────── */

  async testPat(
    accountKey: string,
    pat: string
  ): Promise<{ organizations: number; projects: number }> {
    const [orgs, projects] = await Promise.all([
      this.provider.listOrganizations(accountKey, pat),
      this.provider.listProjects(accountKey, pat),
    ]);
    return { organizations: orgs.length, projects: projects.length };
  }

  /* ── Métriques Free Plan ────────────────────────────────────────────── */

  async getFleetMetrics(refresh: boolean): Promise<FleetMetricsDto> {
    const fleet = await this.getFleet(false);
    const projects: ProjectMetricsDto[] = [];
    for (const af of fleet.accounts) {
      if (!af.account.enabled) continue;
      const account = this.store.getAccount(af.account.id);
      if (!account) continue;
      for (const project of af.projects) {
        projects.push(
          await this.projectMetrics(
            account.id,
            account.patCipher,
            project,
            refresh
          )
        );
      }
    }
    return { projects, generatedAt: new Date().toISOString() };
  }

  private async projectMetrics(
    accountId: string,
    patCipher: string,
    project: ProjectDto,
    refresh: boolean
  ): Promise<ProjectMetricsDto> {
    const cached = this.store.getMetrics(accountId, project.ref);
    const isActive =
      project.status === 'ACTIVE_HEALTHY' ||
      project.status === 'ACTIVE_UNHEALTHY';

    const freshEnough = (kind: string): boolean => {
      const m = cached.find(c => c.kind === kind);
      return (
        !!m?.measuredAt &&
        Date.now() - Date.parse(m.measuredAt) < METRICS_TTL_MS
      );
    };

    if (isActive && (refresh || !freshEnough('dbSize'))) {
      try {
        const pat = openSecret(patCipher, this.masterKey);
        const collected = await this.provider.collectMetrics(
          accountId,
          pat,
          project.ref
        );
        const updates: MetricValue[] = [
          metric(
            'dbSize',
            collected.dbSizeBytes,
            'measured',
            collected.measuredAt
          ),
          metric(
            'storage',
            collected.storageBytes,
            'measured',
            collected.measuredAt
          ),
          metric('mau', collected.mau, 'estimated', collected.measuredAt),
          metric(
            'egress',
            collected.egressBytes,
            'measured',
            collected.measuredAt
          ),
        ];
        for (const u of updates) {
          if (u.state !== 'unavailable') {
            this.store.upsertMetric(accountId, project.ref, u);
          }
        }
      } catch {
        // Collecte impossible → on retombe sur le cache (état stale).
      }
    }

    const latest = this.store.getMetrics(accountId, project.ref);
    const byKind = new Map(latest.map(m => [m.kind, m]));
    const metrics = (['egress', 'dbSize', 'mau', 'storage'] as const).map(
      kind => {
        const m = byKind.get(kind);
        if (!m || m.value === null) return unavailableMetric(kind);
        const fresh =
          !!m.measuredAt &&
          Date.now() - Date.parse(m.measuredAt) < METRICS_TTL_MS;
        // Projet en pause ou mesure ancienne → dernier état connu (stale).
        const state = isActive && fresh ? m.state : 'stale';
        return { ...m, state, quota: FREE_PLAN_QUOTAS[kind] };
      }
    );
    return { accountId, ref: project.ref, metrics };
  }

  /* ── Helpers privés ─────────────────────────────────────────────────── */

  private async loadActionContext(
    accountId: string,
    ref: string
  ): Promise<{
    account: NonNullable<ReturnType<Store['getAccount']>>;
    project: ProjectDto;
    pat: string;
  }> {
    const account = this.store.getAccount(accountId);
    if (!account) {
      throw new FleetError(404, 'account-not-found', 'Compte introuvable');
    }
    if (!account.enabled) {
      throw new FleetError(409, 'account-disabled', 'Compte désactivé');
    }
    const fleet = await this.accountFleet(accountId, true);
    const project = fleet.projects.find(p => p.ref === ref);
    if (!project) {
      throw new FleetError(
        404,
        'project-not-found',
        `Projet ${ref} introuvable`
      );
    }
    const pat = openSecret(account.patCipher, this.masterKey);
    return { account, project, pat };
  }
}

function metric(
  kind: MetricValue['kind'],
  value: number | null,
  state: 'measured' | 'estimated',
  measuredAt: string
): MetricValue {
  if (value === null) return unavailableMetric(kind);
  return { kind, state, value, quota: FREE_PLAN_QUOTAS[kind], measuredAt };
}

function toLite(projects: readonly ProjectDto[]): Lite[] {
  return projects.map(dto => ({
    ref: dto.ref,
    name: dto.name,
    status: dto.status,
    favorite: dto.meta.favorite,
    demoFrequent: dto.meta.demoFrequent,
    tags: dto.meta.tags,
    lastSeenActiveAt: dto.meta.lastSeenActiveAt,
    dto,
  }));
}

function toAssessmentDto(
  assessment: ReturnType<typeof evaluateRestore<Lite>>
): RestoreAssessmentDto {
  return {
    allowed: assessment.allowed,
    reason: assessment.reason,
    activeCount: assessment.activeCount,
    limit: assessment.limit,
    suggestions: assessment.suggestions.map(s => s.dto),
  };
}

function toAccountDto(row: {
  id: string;
  alias: string;
  color: string;
  enabled: boolean;
  patHint: string;
  createdAt: string;
  lastSyncAt: string | null;
  lastError: string | null;
}): AccountDto {
  return {
    id: row.id,
    alias: row.alias,
    color: row.color,
    enabled: row.enabled,
    patHint: row.patHint,
    createdAt: row.createdAt,
    lastSyncAt: row.lastSyncAt,
    lastError: row.lastError,
  };
}
