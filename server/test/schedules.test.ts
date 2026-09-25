// @vitest-environment node
/**
 * Plannings : routes (RBAC, validation), exécution par les MÊMES garde-fous
 * qu'un clic, et les deux promesses de l'exécuteur — idempotent, et jamais
 * deux fois la même échéance, même après un redémarrage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, SCHEMA_VERSION } from '../src/db.ts';
import { BackgroundJobs } from '../src/jobs.ts';
import { describeSchedule } from '../src/schedules.ts';
import { CSRF, startTestServer, type TestServer } from './helpers.ts';

let t: TestServer;
let cookie: string;
let accountId: string;

beforeEach(async () => {
  t = await startTestServer();
  cookie = await t.login();
  accountId = await t.addAccount(cookie);
});

afterEach(async () => {
  await t.close();
});

const url = (ref: string, suffix = '') =>
  `/api/projects/${accountId}/${ref}/schedules${suffix}`;

async function create(
  ref: string,
  payload: Record<string, unknown>,
  who = cookie
) {
  return t.app.inject({
    method: 'POST',
    url: url(ref),
    headers: { cookie: who, ...CSRF },
    payload,
  });
}

/** Un planning hebdomadaire créé par la route, rendu « dû » à `dueAt`. */
async function dueSchedule(
  ref: string,
  action: 'pause' | 'restore',
  dueAt: Date
): Promise<string> {
  const res = await create(ref, {
    kind: 'weekly',
    action,
    weekday: 5,
    time: '19:00',
  });
  expect(res.statusCode).toBe(201);
  const { schedule } = res.json() as { schedule: { id: string } };
  t.store.db
    .prepare('UPDATE schedules SET next_run_at=? WHERE id=?')
    .run(dueAt.toISOString(), schedule.id);
  return schedule.id;
}

describe('routes', () => {
  it('création hebdomadaire : fuseau Europe/Paris par défaut, prochaine exécution calculée', async () => {
    const res = await create('demo-crm-poc', {
      kind: 'weekly',
      action: 'pause',
      weekday: 5,
      time: '19:00',
    });
    expect(res.statusCode).toBe(201);
    const { schedule } = res.json() as {
      schedule: { timezone: string; nextRunAt: string; createdBy: string };
    };
    expect(schedule.timezone).toBe('Europe/Paris');
    expect(schedule.createdBy).toBe('admin@test');
    expect(Date.parse(schedule.nextRunAt)).toBeGreaterThan(Date.now());
    const hour = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(Date.parse(schedule.nextRunAt));
    expect(hour).toBe('vendredi 19:00');

    const list = await t.app.inject({
      method: 'GET',
      url: url('demo-crm-poc'),
      headers: { cookie },
    });
    expect((list.json() as { schedules: unknown[] }).schedules).toHaveLength(1);
    expect(
      t.store.listOperations(5).find(o => o.action === 'schedule.create')
        ?.detail
    ).toBe('Pause chaque vendredi à 19:00 (Europe/Paris)');
  });

  it('ponctuel : à venir accepté, passé refusé', async () => {
    const future = new Date(Date.now() + 3 * 24 * 3600_000);
    const at = `${future.toISOString().slice(0, 10)}T08:30`;
    const ok = await create('hackathon-2026', {
      kind: 'once',
      action: 'restore',
      at,
      timezone: 'UTC',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({
      schedule: {
        kind: 'once',
        at,
        nextRunAt: `${at}:00.000Z`,
        weekday: null,
      },
    });

    const past = await create('hackathon-2026', {
      kind: 'once',
      action: 'restore',
      at: '2020-01-01T10:00',
    });
    expect(past.statusCode).toBe(400);
    expect(past.json()).toMatchObject({ error: 'schedule-in-past' });
  });

  it.each([
    [{ kind: 'weekly', action: 'pause', weekday: 8, time: '19:00' }],
    [{ kind: 'weekly', action: 'pause', weekday: 5, time: '7h' }],
    [{ kind: 'once', action: 'pause', at: '2026-02-30T10:00' }],
    [
      {
        kind: 'weekly',
        action: 'pause',
        weekday: 5,
        time: '19:00',
        timezone: 'Mars/Olympus',
      },
    ],
    [{ kind: 'weekly', action: 'delete', weekday: 5, time: '19:00' }],
  ])('corps invalide %o : 400', async payload => {
    const res = await create('demo-crm-poc', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation' });
  });

  it('projet ou compte inconnus : 404 ; au-delà de dix : 409', async () => {
    const weekly = {
      kind: 'weekly',
      action: 'pause',
      weekday: 1,
      time: '08:00',
    };
    expect((await create('nexiste-pas', weekly)).statusCode).toBe(404);
    const noAccount = await t.app.inject({
      method: 'POST',
      url: '/api/projects/inconnu/demo-crm-poc/schedules',
      headers: { cookie, ...CSRF },
      payload: weekly,
    });
    expect(noAccount.statusCode).toBe(404);

    for (let i = 0; i < 10; i += 1) {
      expect((await create('demo-crm-poc', weekly)).statusCode).toBe(201);
    }
    const eleventh = await create('demo-crm-poc', weekly);
    expect(eleventh.statusCode).toBe(409);
    expect(eleventh.json()).toMatchObject({ error: 'too-many-schedules' });
  });

  it('RBAC : lire pour tous, écrire pour qui peut déjà mettre en pause', async () => {
    const viewer = await t.login('viewer@test');
    const operator = await t.login('operator@test');
    const weekly = {
      kind: 'weekly',
      action: 'pause',
      weekday: 1,
      time: '08:00',
    };

    expect((await create('demo-crm-poc', weekly, viewer)).statusCode).toBe(403);
    const made = await create('demo-crm-poc', weekly, operator);
    expect(made.statusCode).toBe(201);
    const id = (made.json() as { schedule: { id: string } }).schedule.id;

    const read = await t.app.inject({
      method: 'GET',
      url: url('demo-crm-poc'),
      headers: { cookie: viewer },
    });
    expect(read.statusCode).toBe(200);
    const viewerDelete = await t.app.inject({
      method: 'DELETE',
      url: url('demo-crm-poc', `/${id}`),
      headers: { cookie: viewer, ...CSRF },
    });
    expect(viewerDelete.statusCode).toBe(403);
    const noCsrf = await t.app.inject({
      method: 'DELETE',
      url: url('demo-crm-poc', `/${id}`),
      headers: { cookie: operator },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('suppression : seulement depuis son projet, puis consignée', async () => {
    const made = await create('demo-crm-poc', {
      kind: 'weekly',
      action: 'pause',
      weekday: 1,
      time: '08:00',
    });
    const id = (made.json() as { schedule: { id: string } }).schedule.id;
    const wrongProject = await t.app.inject({
      method: 'DELETE',
      url: url('ia-rag-demo', `/${id}`),
      headers: { cookie, ...CSRF },
    });
    expect(wrongProject.statusCode).toBe(404);

    const ok = await t.app.inject({
      method: 'DELETE',
      url: url('demo-crm-poc', `/${id}`),
      headers: { cookie, ...CSRF },
    });
    expect(ok.statusCode).toBe(200);
    expect(t.store.getSchedule(id)).toBeNull();
    expect(
      t.store.listOperations(5).some(o => o.action === 'schedule.delete')
    ).toBe(true);
  });

  it('un compte supprimé emporte ses plannings (cascade)', async () => {
    await create('demo-crm-poc', {
      kind: 'weekly',
      action: 'pause',
      weekday: 1,
      time: '08:00',
    });
    await t.app.inject({
      method: 'DELETE',
      url: `/api/accounts/${accountId}`,
      headers: { cookie, ...CSRF },
    });
    expect(
      t.store.db.prepare('SELECT COUNT(*) AS n FROM schedules').get()
    ).toEqual({ n: 0 });
  });
});

describe('exécution', () => {
  it('une pause due passe par le service, est consignée, et avance d’une semaine', async () => {
    const now = new Date();
    const id = await dueSchedule(
      'demo-crm-poc',
      'pause',
      new Date(now.getTime() - 60_000)
    );
    expect(await t.ctx.schedules.runDue(now)).toBe(1);

    const project = (await t.provider.listProjects()).find(
      p => p.ref === 'demo-crm-poc'
    );
    expect(project?.status).toBe('PAUSING');
    const op = t.store
      .listOperations(10)
      .find(o => o.action === 'project.pause');
    expect(op).toMatchObject({
      status: 'ok',
      userEmail: 'planning:admin@test',
      detail: 'Planning — Pause chaque vendredi à 19:00 (Europe/Paris)',
    });
    const schedule = t.store.getSchedule(id);
    expect(schedule?.lastStatus).toBe('ok');
    expect(Date.parse(schedule?.nextRunAt ?? '')).toBeGreaterThan(
      now.getTime()
    );

    // IDEMPOTENT : la même passe relancée ne trouve plus rien.
    expect(await t.ctx.schedules.runDue(now)).toBe(0);
    expect(
      t.store.listOperations(20).filter(o => o.action === 'project.pause')
    ).toHaveLength(1);
  });

  it('deux passes simultanées ne jouent pas deux fois la même échéance', async () => {
    const now = new Date();
    // DEUX échéances : la première passe les lit toutes les deux, joue A,
    // et pendant qu'elle attend Supabase la seconde passe prend B. Revenue,
    // la première tente B avec une lecture périmée — la réservation
    // conditionnelle doit la lui refuser.
    await dueSchedule('demo-crm-poc', 'pause', new Date(now.getTime() - 2000));
    await dueSchedule('ia-rag-demo', 'pause', new Date(now.getTime() - 1000));
    const claim = vi.spyOn(t.store, 'claimScheduleRun');
    const [a, b] = await Promise.all([
      t.ctx.schedules.runDue(now),
      t.ctx.schedules.runDue(now),
    ]);
    expect(a + b).toBe(2);
    expect(claim).toHaveBeenCalledTimes(3);
    expect(claim.mock.results.map(r => r.value)).toEqual([true, true, false]);
    const pauses = t.store
      .listOperations(20)
      .filter(o => o.action === 'project.pause');
    expect(pauses.map(o => o.projectRef).sort()).toEqual([
      'demo-crm-poc',
      'ia-rag-demo',
    ]);
  });

  it('LIMITE DES 2 ACTIFS : une restauration planifiée est refusée et consignée', async () => {
    const now = new Date();
    const id = await dueSchedule(
      'hackathon-2026',
      'restore',
      new Date(now.getTime() - 1000)
    );
    await t.ctx.schedules.runDue(now);

    const schedule = t.store.getSchedule(id);
    expect(schedule?.lastStatus).toBe('refused');
    expect(schedule?.lastDetail).toMatch(
      /garde-fou.*Limite Free atteinte \(2\/2\)/
    );
    const op = t.store
      .listOperations(10)
      .find(o => o.action === 'project.restore');
    expect(op).toMatchObject({
      status: 'error',
      userEmail: 'planning:admin@test',
      projectRef: 'hackathon-2026',
    });
    expect(op?.detail).toMatch(/refusé par un garde-fou/);
    // Rien n'a bougé chez Supabase.
    const projects = await t.provider.listProjects();
    expect(projects.find(p => p.ref === 'hackathon-2026')?.status).toBe(
      'INACTIVE'
    );
    expect(projects.filter(p => p.status === 'PAUSING')).toHaveLength(0);
  });

  it('pause d’un projet déjà en pause : refusée par le garde-fou', async () => {
    const now = new Date();
    const id = await dueSchedule(
      'client-pitch',
      'pause',
      new Date(now.getTime() - 1000)
    );
    await t.ctx.schedules.runDue(now);
    expect(t.store.getSchedule(id)).toMatchObject({
      lastStatus: 'refused',
      lastDetail: expect.stringMatching(/n'est pas actif/),
    });
  });

  it('compte désactivé : refus consigné', async () => {
    const now = new Date();
    const id = await dueSchedule(
      'demo-crm-poc',
      'pause',
      new Date(now.getTime() - 1000)
    );
    t.store.updateAccount(accountId, { enabled: false });
    await t.ctx.schedules.runDue(now);
    expect(t.store.getSchedule(id)).toMatchObject({
      lastStatus: 'refused',
      lastDetail: expect.stringMatching(/Compte désactivé/),
    });
  });

  it('restauration acceptée quand un slot est libre', async () => {
    const now = new Date();
    await t.ctx.fleet.pause('admin@test', accountId, 'ia-rag-demo');
    // Le mock passe à INACTIVE après 4 s ; on n'attend pas : PAUSING compte
    // encore dans la limite, donc on force l'état observé.
    const raw = await t.provider.listProjects();
    expect(raw.find(p => p.ref === 'ia-rag-demo')?.status).toBe('PAUSING');
    (
      t.provider as unknown as {
        projects: { ref: string; status: string }[];
      }
    ).projects.forEach(p => {
      if (p.ref === 'ia-rag-demo') p.status = 'INACTIVE';
    });
    const id = await dueSchedule(
      'hackathon-2026',
      'restore',
      new Date(now.getTime() - 1000)
    );
    await t.ctx.schedules.runDue(now);
    expect(t.store.getSchedule(id)?.lastStatus).toBe('ok');
    const op = t.store
      .listOperations(10)
      .find(o => o.action === 'project.restore');
    expect(op).toMatchObject({ status: 'ok' });
    expect(op?.detail).toMatch(/^Planning — Restauration chaque vendredi/);
  });

  it('erreur Supabase : consignée UNE fois (par le service), planning en erreur', async () => {
    const now = new Date();
    const id = await dueSchedule(
      'demo-crm-poc',
      'pause',
      new Date(now.getTime() - 1000)
    );
    vi.spyOn(t.provider, 'pauseProject').mockRejectedValueOnce(
      new Error('HTTP 500 sur /v1/projects/demo-crm-poc/pause')
    );
    await t.ctx.schedules.runDue(now);
    expect(t.store.getSchedule(id)).toMatchObject({
      lastStatus: 'error',
      lastDetail: expect.stringMatching(/HTTP 500/),
    });
    const ops = t.store
      .listOperations(10)
      .filter(o => o.action === 'project.pause');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ status: 'error' });
    expect(ops[0]?.detail).toMatch(/^Planning — .* — HTTP 500/);
  });

  it('échéance manquée de plus d’une heure : consignée, PAS rattrapée', async () => {
    const now = new Date();
    const id = await dueSchedule(
      'demo-crm-poc',
      'pause',
      new Date(now.getTime() - 2 * 3600_000)
    );
    await t.ctx.schedules.runDue(now);
    expect(t.store.getSchedule(id)?.lastStatus).toBe('missed');
    const projects = await t.provider.listProjects();
    expect(projects.find(p => p.ref === 'demo-crm-poc')?.status).toBe(
      'ACTIVE_HEALTHY'
    );
    const op = t.store
      .listOperations(10)
      .find(o => o.action === 'project.pause');
    expect(op?.status).toBe('error');
    expect(op?.detail).toMatch(/manquée/);
  });

  it('ponctuel : joué une fois, puis plus d’échéance', async () => {
    const future = new Date(Date.now() + 24 * 3600_000);
    const res = await create('demo-crm-poc', {
      kind: 'once',
      action: 'pause',
      at: `${future.toISOString().slice(0, 16)}`,
      timezone: 'UTC',
    });
    const id = (res.json() as { schedule: { id: string } }).schedule.id;
    const runAt = new Date(future.getTime() + 1000);
    expect(await t.ctx.schedules.runDue(runAt)).toBe(1);
    expect(t.store.getSchedule(id)).toMatchObject({
      nextRunAt: null,
      lastStatus: 'ok',
    });
    expect(
      await t.ctx.schedules.runDue(
        new Date(runAt.getTime() + 7 * 24 * 3600_000)
      )
    ).toBe(0);
  });

  it('REDÉMARRAGE : une exécution coupée n’est pas rejouée, elle est signalée', async () => {
    const now = new Date();
    const id = await dueSchedule('demo-crm-poc', 'pause', now);
    // Simule un arrêt APRÈS la réservation, AVANT la fin : l'échéance a déjà
    // avancé, le statut est resté « running ».
    const next = new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();
    expect(
      t.store.claimScheduleRun(id, now.toISOString(), next, now.toISOString())
    ).toBe(true);

    expect(t.ctx.schedules.recoverInterrupted()).toBe(1);
    expect(t.store.getSchedule(id)).toMatchObject({
      lastStatus: 'error',
      nextRunAt: next,
    });
    expect(
      t.store.listOperations(5).find(o => o.action === 'project.pause')?.detail
    ).toMatch(/interrompue par un arrêt du serveur/);
    // La passe suivante ne rejoue rien.
    expect(await t.ctx.schedules.runDue(now)).toBe(0);
    expect(t.ctx.schedules.recoverInterrupted()).toBe(0);
  });
});

describe('describeSchedule', () => {
  it('ponctuel et hebdomadaire, en clair', () => {
    expect(
      describeSchedule({
        action: 'restore',
        kind: 'once',
        at: '2026-10-02T08:30',
        weekday: null,
        time: null,
        timezone: 'Europe/Paris',
      })
    ).toBe('Restauration le 02/10/2026 à 08:30 (Europe/Paris)');
  });
});

describe('tâche de fond', () => {
  it('joue les plannings à chaque passe, synchronise à l’intervalle, sans chevauchement', async () => {
    const runDue = vi.spyOn(t.ctx.schedules, 'runDue');
    const getFleet = vi.spyOn(t.ctx.fleet, 'getFleet');
    const getMetrics = vi.spyOn(t.ctx.fleet, 'getFleetMetrics');
    const jobs = new BackgroundJobs({
      env: { syncIntervalMin: 15, syncMetrics: false },
      fleet: t.ctx.fleet,
      schedules: t.ctx.schedules,
    });
    const t0 = Date.parse('2026-09-25T10:00:00Z');

    await Promise.all([jobs.tick(new Date(t0)), jobs.tick(new Date(t0))]);
    expect(runDue).toHaveBeenCalledTimes(1); // la seconde est sautée
    expect(getFleet).toHaveBeenCalledWith(true);
    expect(getFleet).toHaveBeenCalledTimes(1);

    await jobs.tick(new Date(t0 + 60_000));
    expect(runDue).toHaveBeenCalledTimes(2);
    expect(getFleet).toHaveBeenCalledTimes(1); // pas encore 15 min

    await jobs.tick(new Date(t0 + 15 * 60_000));
    expect(getFleet).toHaveBeenCalledTimes(2);
    expect(getMetrics).not.toHaveBeenCalled();
  });

  it('SUPABOSS_SYNC_METRICS : les quotas aussi ; 0 : aucune synchro', async () => {
    const getFleet = vi.spyOn(t.ctx.fleet, 'getFleet');
    const getMetrics = vi.spyOn(t.ctx.fleet, 'getFleetMetrics');
    await new BackgroundJobs({
      env: { syncIntervalMin: 5, syncMetrics: true },
      fleet: t.ctx.fleet,
      schedules: t.ctx.schedules,
    }).tick();
    expect(getMetrics).toHaveBeenCalledWith(false);

    getFleet.mockClear();
    await new BackgroundJobs({
      env: { syncIntervalMin: 0, syncMetrics: true },
      fleet: t.ctx.fleet,
      schedules: t.ctx.schedules,
    }).tick();
    expect(getFleet).not.toHaveBeenCalled();
  });

  it('une panne est rapportée, et la passe suivante repart', async () => {
    const errors: string[] = [];
    vi.spyOn(t.ctx.schedules, 'runDue').mockRejectedValueOnce(new Error('x'));
    vi.spyOn(t.ctx.fleet, 'getFleet').mockRejectedValueOnce(new Error('y'));
    const jobs = new BackgroundJobs({
      env: { syncIntervalMin: 1, syncMetrics: false },
      fleet: t.ctx.fleet,
      schedules: t.ctx.schedules,
      onError: (_e, what) => errors.push(what),
    });
    await jobs.tick();
    expect(errors).toEqual(['plannings', 'synchro de fond']);
    jobs.start();
    jobs.start(); // sans effet : un seul minuteur
    jobs.stop();
  });
});

describe('migration de schéma', () => {
  it('une base v1 existante monte en v2 sans perte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'supaboss-migration-'));
    try {
      const path = join(dir, 'supaboss.db');
      const v2 = new Store(path);
      v2.createUser('ancien@test', 'hash', 'admin');
      // Ramène la base à ce qu'était une v1 : sans les tables de la v2.
      for (const table of [
        'user_totp',
        'totp_recovery_codes',
        'login_challenges',
        'schedules',
        'notification_channels',
        'push_subscriptions',
        'alert_marks',
      ]) {
        v2.db.exec(`DROP TABLE ${table}`);
      }
      v2.db.exec(`UPDATE meta SET value='1' WHERE key='schema_version'`);
      v2.close();

      const reopened = new Store(path);
      expect(reopened.schemaVersion()).toBe(SCHEMA_VERSION);
      expect(SCHEMA_VERSION).toBe(2);
      expect(reopened.findUserByEmail('ancien@test')).not.toBeNull();
      expect(reopened.listDueSchedules(new Date().toISOString())).toEqual([]);
      reopened.close();

      // Rouvrir une base à jour ne rejoue rien (les CREATE TABLE échoueraient).
      const again = new Store(path);
      expect(again.schemaVersion()).toBe(2);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
