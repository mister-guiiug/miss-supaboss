/**
 * Scénarios contractuels partagés — exécutés contre chaque implémentation `Api`
 * (mock navigateur, local-first, serveur via inject).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, type Api } from '../../src/api/types.ts';

export interface ApiContractContext {
  accountId: string;
  /** Projet actif à mettre en pause pour libérer un slot. */
  pauseFirstRef: string;
  /** Projet inactif à restaurer. */
  restoreTargetRef: string;
  /** Projet déjà inactif — pause doit échouer. */
  nonPausableRef: string;
  /** Projet actif pour vérifier les métriques. */
  activeMetricsRef: string;
}

export interface ApiContractOptions {
  name: string;
  createApi: () => Api | Promise<Api>;
  /** Contexte statique (mock pré-seedé) ou fourni par `prepare`. */
  ctx?: ApiContractContext;
  /** Crée un compte + charge la flotte avant les tests. */
  prepare?: (api: Api) => Promise<ApiContractContext>;
  beforeEachHook?: () => void | Promise<void>;
  afterEachHook?: () => void | Promise<void>;
}

export function apiContractTests(options: ApiContractOptions): void {
  const { name, createApi, ctx, prepare, beforeEachHook, afterEachHook } =
    options;

  describe(`contrat Api — ${name}`, () => {
    let api: Api;
    let context: ApiContractContext;

    if (beforeEachHook) beforeEach(() => beforeEachHook());
    if (afterEachHook) afterEach(() => afterEachHook());

    beforeEach(async () => {
      api = await createApi();
      if (prepare) {
        context = await prepare(api);
      } else if (ctx) {
        context = ctx;
        await api.getFleet(true);
      } else {
        throw new Error(`contrat Api — ${name} : ctx ou prepare requis`);
      }
    });

    it('getFleet expose des projets pour le compte', async () => {
      const fleet = await api.getFleet(false);
      const account = fleet.accounts.find(
        a => a.account.id === context.accountId
      );
      expect(account?.projects.length).toBeGreaterThanOrEqual(3);
    });

    it('assessRestore signale la limite Free à 2 actifs', async () => {
      const assessment = await api.assessRestore(
        context.accountId,
        context.restoreTargetRef
      );
      expect(assessment.allowed).toBe(false);
      expect(assessment.reason).toBe('limit-reached');
      expect(assessment.activeCount).toBe(2);
      expect(assessment.limit).toBe(2);
      expect(assessment.suggestions.length).toBeGreaterThan(0);
    });

    it('restore refusé sans pause (409 limit-reached + assessment)', async () => {
      await expect(
        api.restoreProject(context.accountId, context.restoreTargetRef, {
          pauseFirst: [],
          force: false,
        })
      ).rejects.toMatchObject({
        code: 'limit-reached',
        assessment: { activeCount: 2, limit: 2 },
      });
    });

    it('restore accepté avec pauseFirst', async () => {
      await api.restoreProject(context.accountId, context.restoreTargetRef, {
        pauseFirst: [context.pauseFirstRef],
        force: false,
      });
      const fleet = await api.getFleet(true);
      const projects =
        fleet.accounts.find(a => a.account.id === context.accountId)
          ?.projects ?? [];
      const paused = projects.find(p => p.ref === context.pauseFirstRef);
      const restored = projects.find(p => p.ref === context.restoreTargetRef);
      expect(paused?.status).toBe('PAUSING');
      expect(restored?.status).toBe('RESTORING');
    });

    it('pause d’un projet inactif → 409 not-pausable', async () => {
      await expect(
        api.pauseProject(context.accountId, context.nonPausableRef)
      ).rejects.toMatchObject({ code: 'not-pausable' });
    });

    it('egress indisponible sur projet actif (aucune valeur inventée)', async () => {
      const metrics = await api.getFleetMetrics(true);
      const row = metrics.projects.find(
        p =>
          p.accountId === context.accountId &&
          p.ref === context.activeMetricsRef
      );
      expect(row).toBeDefined();
      const egress = row?.metrics.find(m => m.kind === 'egress');
      expect(egress?.state).toBe('unavailable');
      expect(egress?.value).toBeNull();
    });

    it('updateProjectMeta persistée (relecture getProject)', async () => {
      await api.updateProjectMeta(context.accountId, context.restoreTargetRef, {
        favorite: true,
        tags: ['poc', 'demo'],
      });
      const project = await api.getProject(
        context.accountId,
        context.restoreTargetRef,
        false
      );
      expect(project.meta.favorite).toBe(true);
      expect(project.meta.tags).toEqual(['poc', 'demo']);
    });

    it('listOperations journalise pause + restore', async () => {
      const before = (await api.listOperations(50)).length;
      await api.restoreProject(context.accountId, context.restoreTargetRef, {
        pauseFirst: [context.pauseFirstRef],
        force: false,
      });
      const ops = await api.listOperations(50);
      expect(ops.length).toBeGreaterThan(before);
      expect(
        ops.some(o => o.action === 'project.pause' && o.status === 'ok')
      ).toBe(true);
      expect(
        ops.some(o => o.action === 'project.restore' && o.status === 'ok')
      ).toBe(true);
    });
  });
}

/**
 * Plannings — mêmes règles pour le mock de la démo et le serveur : même
 * schéma de validation, mêmes refus. (Le local-first n'en a pas.)
 */
export function scheduleContractTests(options: ApiContractOptions): void {
  const { name, createApi, ctx, prepare, beforeEachHook, afterEachHook } =
    options;

  describe(`contrat plannings — ${name}`, () => {
    let api: Api;
    let context: ApiContractContext;

    if (beforeEachHook) beforeEach(() => beforeEachHook());
    if (afterEachHook) afterEach(() => afterEachHook());

    beforeEach(async () => {
      api = await createApi();
      if (prepare) context = await prepare(api);
      else if (ctx) context = ctx;
      else {
        throw new Error(`contrat plannings — ${name} : ctx ou prepare requis`);
      }
      // Un planning ne vise qu'un projet qu'une synchro a déjà vu.
      await api.getFleet(true);
    });

    const controller = () => {
      if (!api.schedules) throw new Error('plannings absents');
      return api.schedules;
    };

    it('création hebdomadaire, relue avec sa prochaine exécution, puis supprimée', async () => {
      const created = await controller().create(
        context.accountId,
        context.pauseFirstRef,
        { kind: 'weekly', action: 'pause', weekday: 5, time: '19:00' }
      );
      expect(created).toMatchObject({
        kind: 'weekly',
        action: 'pause',
        weekday: 5,
        time: '19:00',
        timezone: 'Europe/Paris',
      });
      expect(Date.parse(created.nextRunAt ?? '')).toBeGreaterThan(Date.now());

      const listed = await controller().list(
        context.accountId,
        context.pauseFirstRef
      );
      expect(listed.map(s => s.id)).toEqual([created.id]);

      await controller().remove(
        context.accountId,
        context.pauseFirstRef,
        created.id
      );
      expect(
        await controller().list(context.accountId, context.pauseFirstRef)
      ).toEqual([]);
      const ops = await api.listOperations(20);
      expect(ops.some(o => o.action === 'schedule.create')).toBe(true);
      expect(ops.some(o => o.action === 'schedule.delete')).toBe(true);
    });

    it('échéance passée : 400 schedule-in-past', async () => {
      await expect(
        controller().create(context.accountId, context.restoreTargetRef, {
          kind: 'once',
          action: 'restore',
          at: '2020-01-01T10:00',
        })
      ).rejects.toMatchObject({ status: 400, code: 'schedule-in-past' });
    });

    it('corps invalide : 400 validation', async () => {
      await expect(
        controller().create(context.accountId, context.pauseFirstRef, {
          kind: 'weekly',
          action: 'pause',
          weekday: 9,
          time: '19:00',
        })
      ).rejects.toMatchObject({ status: 400, code: 'validation' });
    });

    it('projet inconnu : 404 ; planning inconnu : 404', async () => {
      await expect(
        controller().create(context.accountId, 'projet-fantome', {
          kind: 'weekly',
          action: 'pause',
          weekday: 1,
          time: '08:00',
        })
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        controller().remove(
          context.accountId,
          context.pauseFirstRef,
          'planning-fantome'
        )
      ).rejects.toMatchObject({ status: 404, code: 'schedule-not-found' });
    });
  });
}

export { ApiError };
