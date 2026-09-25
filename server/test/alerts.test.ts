// @vitest-environment node
/**
 * Alertes : franchissement À LA HAUSSE d'un niveau, une fois par niveau et
 * par période ; fin de fenêtre de restauration à J-7 puis J-1. Évaluées côté
 * serveur à chaque synchro — éprouvé ici de bout en bout par les routes, et
 * finement par `evaluate` avec une horloge choisie.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FREE_PLAN_QUOTAS, MB } from '../../shared/quotas.ts';
import type { ProjectDto, SettingsDto } from '../../shared/contracts.ts';
import { DEFAULT_SETTINGS } from '../../shared/contracts.ts';
import type { FleetSyncEvent } from '../src/fleet.ts';
import {
  CSRF,
  fakeBrowser,
  startTestServer,
  type TestEmail,
  type TestServer,
} from './helpers.ts';

let t: TestServer;
let cookie: string;

const DAY = 24 * 3600_000;

beforeEach(async () => {
  t = await startTestServer();
  cookie = await t.login();
});

afterEach(async () => {
  await t.close();
});

/** Abonne un navigateur de test pour `email` ; rend son déchiffreur. */
async function withPush(email: TestEmail = 'admin@test') {
  const who = email === 'admin@test' ? cookie : await t.login(email);
  const browser = fakeBrowser(`https://push.example.test/${email}`);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/notifications/push-subscriptions',
    headers: { cookie: who, ...CSRF },
    payload: { subscription: browser.subscription },
  });
  expect(res.statusCode).toBe(201);
  return browser;
}

function putSettings(email: TestEmail, patch: Partial<SettingsDto>) {
  const user = t.store.findUserByEmail(email);
  if (!user) throw new Error(`${email} absent`);
  t.store.putSettings(user.id, { ...DEFAULT_SETTINGS, ...patch });
}

/** Titres des notifications parties vers `browser`. */
function titlesFor(browser: ReturnType<typeof fakeBrowser>): string[] {
  return t.net.sent
    .filter(r => r.url === browser.subscription.endpoint)
    .map(
      r =>
        (
          JSON.parse(browser.decrypt(r.init.body as Buffer)) as {
            title: string;
          }
        ).title
    );
}

function dbSizeEvent(ratio: number, measuredAt: string): FleetSyncEvent {
  return {
    type: 'metrics',
    items: [
      {
        accountId: 'acc-1',
        accountAlias: 'Lab',
        ref: 'crm',
        name: 'CRM POC',
        metrics: [
          {
            kind: 'dbSize',
            state: 'measured',
            value: Math.round(FREE_PLAN_QUOTAS.dbSize * ratio),
            quota: FREE_PLAN_QUOTAS.dbSize,
            measuredAt,
          },
        ],
      },
    ],
  };
}

/** `alert_marks` référence `accounts` : un compte réel pour les événements. */
function seedAccount(): void {
  t.store.db
    .prepare(
      `INSERT INTO accounts(id, alias, color, enabled, pat_cipher, pat_hint, created_at, updated_at)
       VALUES ('acc-1','Lab','#3ecf8e',1,'x','sbp_…x',?,?)`
    )
    .run(new Date().toISOString(), new Date().toISOString());
}

describe('quotas — franchissements', () => {
  beforeEach(seedAccount);

  it('une alerte par niveau franchi à la hausse, jamais deux', async () => {
    const browser = await withPush();
    const sept = '2026-09-10T10:00:00.000Z';
    const evaluate = (ratio: number, at = sept) =>
      t.ctx.alerts.evaluate(dbSizeEvent(ratio, at));

    expect(await evaluate(0.5)).toBe(0); // sous 70 %
    expect(await evaluate(0.72)).toBe(1); // warn
    expect(await evaluate(0.74)).toBe(0); // toujours warn : rien
    expect(await evaluate(0.9)).toBe(1); // high
    expect(await evaluate(0.8)).toBe(0); // redescend : rien
    expect(await evaluate(0.9)).toBe(0); // remonte au même niveau : rien
    expect(await evaluate(0.97)).toBe(1); // critical
    expect(await evaluate(0.99)).toBe(0);

    expect(titlesFor(browser)).toEqual([
      'Database size à 72 % — CRM POC',
      'Database size à 90 % — CRM POC',
      'Database size à 97 % — CRM POC',
    ]);
    // Nouvelle période de quota : le niveau peut resonner.
    expect(await evaluate(0.9, '2026-10-02T10:00:00.000Z')).toBe(1);
  });

  it('un saut direct n’annonce que le niveau atteint', async () => {
    const browser = await withPush();
    await t.ctx.alerts.evaluate(dbSizeEvent(0.99, '2026-09-10T10:00:00Z'));
    expect(titlesFor(browser)).toEqual(['Database size à 99 % — CRM POC']);
    const detail = t.store
      .listOperations(5)
      .find(o => o.action === 'alert.send')?.detail;
    expect(detail).toMatch(/Seuil critique \(95 %\)|push : 1 appareil/);
  });

  it('valeurs « dernier état connu » ou indisponibles : ignorées', async () => {
    await withPush();
    const stale = dbSizeEvent(0.99, '2026-09-10T10:00:00Z');
    if (stale.type !== 'metrics') throw new Error('type');
    const [item] = stale.items;
    if (!item) throw new Error('item');
    item.metrics = [
      { ...item.metrics[0]!, state: 'stale' },
      {
        kind: 'egress',
        state: 'unavailable',
        value: null,
        quota: FREE_PLAN_QUOTAS.egress,
        measuredAt: null,
      },
    ];
    expect(await t.ctx.alerts.evaluate(stale)).toBe(0);
  });

  it('les seuils sont ceux de CHAQUE utilisateur ; sans canal, rien', async () => {
    const admin = await withPush('admin@test');
    const viewer = await withPush('viewer@test');
    putSettings('viewer@test', {
      thresholds: { warn: 50, high: 60, critical: 65 },
    });
    await t.ctx.alerts.evaluate(dbSizeEvent(0.66, '2026-09-10T10:00:00Z'));
    expect(titlesFor(admin)).toEqual([]); // 66 % < 70 %
    expect(titlesFor(viewer)).toEqual(['Database size à 66 % — CRM POC']);
    // L'opérateur n'a aucun canal : ni envoi, ni marque.
    expect(
      t.store.db
        .prepare(
          `SELECT COUNT(*) AS n FROM alert_marks m JOIN users u ON u.id = m.user_id
           WHERE u.email = 'operator@test'`
        )
        .get()
    ).toEqual({ n: 0 });
  });

  it('webhook seul : le JSON part avec le niveau et le projet', async () => {
    await t.app.inject({
      method: 'PUT',
      url: '/api/notifications/webhook',
      headers: { cookie, ...CSRF },
      payload: { url: 'https://ntfy.example.test/supaboss' },
    });
    t.net.respond = () => new Response('ok', { status: 200 });
    await t.ctx.alerts.evaluate(dbSizeEvent(0.86, '2026-09-10T10:00:00Z'));
    const hook = t.net.sent[0];
    const json = JSON.parse(String(hook?.init.body)) as Record<string, unknown>;
    expect(json).toMatchObject({
      event: 'quota.threshold',
      level: 'high',
      title: 'Database size à 86 % — CRM POC',
      path: '#/projects/acc-1/crm',
      project: { accountAlias: 'Lab', ref: 'crm', name: 'CRM POC' },
    });
    expect(String(json.message)).toMatch(
      /^Seuil élevé \(85 %\) franchi sur « Lab » : 430 Mo \/ 500 Mo\.$/
    );
  });
});

describe('fenêtre de restauration — J-7 et J-1', () => {
  beforeEach(seedAccount);

  const paused = (
    pausedAt: string | null,
    status: ProjectDto['status'] = 'INACTIVE'
  ): FleetSyncEvent => ({
    type: 'fleet',
    account: { id: 'acc-1', alias: 'Lab' },
    projects: [
      {
        accountId: 'acc-1',
        ref: 'hack',
        name: 'Hackathon',
        region: 'eu-west-3',
        organizationSlug: 'org',
        organizationName: 'Org',
        status,
        createdAt: '2026-01-01T00:00:00Z',
        meta: {
          tags: [],
          favorite: false,
          demoFrequent: false,
          notes: '',
          lastSeenActiveAt: null,
          pausedAt,
          restoreDeadline: null,
        },
      },
    ],
  });

  it('J-7, puis J-1, une fois chacun ; rien après l’échéance', async () => {
    const browser = await withPush();
    const pausedAt = '2026-06-20T10:00:00.000Z'; // + 90 j = 18/09/2026 10:00Z
    const at = (iso: string) =>
      t.ctx.alerts.evaluate(paused(pausedAt), new Date(iso));

    expect(await at('2026-09-01T10:00:00Z')).toBe(0); // J-17
    expect(await at('2026-09-11T11:00:00Z')).toBe(1); // J-6,9 → J-7
    expect(await at('2026-09-12T10:00:00Z')).toBe(0);
    expect(await at('2026-09-17T11:00:00Z')).toBe(1); // < 1 jour → J-1
    expect(await at('2026-09-17T20:00:00Z')).toBe(0);
    expect(await at('2026-09-19T10:00:00Z')).toBe(0); // dépassée
    expect(titlesFor(browser)).toEqual([
      'J-7 avant la fin de la fenêtre de restauration — Hackathon',
      'J-1 avant la fin de la fenêtre de restauration — Hackathon',
    ]);
  });

  it('suit la fenêtre RÉGLÉE par l’utilisateur ; nouvel épisode de pause, nouvelles alertes', async () => {
    await withPush();
    putSettings('admin@test', { restoreWindowDays: 30 });
    const now = new Date('2026-09-25T10:00:00Z');
    const pausedAt = new Date(now.getTime() - 25 * DAY).toISOString();
    expect(await t.ctx.alerts.evaluate(paused(pausedAt), now)).toBe(1);
    const again = new Date(now.getTime() - 24 * DAY).toISOString();
    expect(await t.ctx.alerts.evaluate(paused(again), now)).toBe(1);
  });

  it('date de pause inconnue, ou projet actif : aucune échéance inventée', async () => {
    await withPush();
    const now = new Date('2026-09-25T10:00:00Z');
    expect(await t.ctx.alerts.evaluate(paused(null), now)).toBe(0);
    const recent = new Date(now.getTime() - 89 * DAY).toISOString();
    expect(
      await t.ctx.alerts.evaluate(paused(recent, 'ACTIVE_HEALTHY'), now)
    ).toBe(0);
  });
});

describe('de bout en bout, à chaque synchro', () => {
  it('une collecte de métriques déclenche les alertes de quota', async () => {
    const browser = await withPush();
    // Seuils très bas : les ~30-50 Mo du fournisseur mock deviennent critiques.
    putSettings('admin@test', {
      thresholds: { warn: 1, high: 2, critical: 3 },
    });
    await t.addAccount(cookie);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/fleet/metrics',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    await t.ctx.alerts.idle();
    const titles = titlesFor(browser).sort();
    expect(titles).toHaveLength(2);
    expect(titles[0]).toMatch(/^Database size à \d+ % — CRM POC$/);
    expect(titles[1]).toMatch(/^Database size à \d+ % — RAG Démo IA$/);

    // Synchro suivante : même niveau, aucune redite.
    await t.app.inject({
      method: 'GET',
      url: '/api/fleet/metrics?refresh=1',
      headers: { cookie },
    });
    await t.ctx.alerts.idle();
    expect(titlesFor(browser)).toHaveLength(2);
  });

  it('une synchro de flotte déclenche l’alerte de fin de fenêtre', async () => {
    const browser = await withPush();
    putSettings('admin@test', { restoreWindowDays: 1 });
    const accountId = await t.addAccount(cookie);
    await t.app.inject({
      method: 'POST',
      url: `/api/projects/${accountId}/demo-crm-poc/pause`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
    // Le mock bascule en INACTIVE après 4 s : on n'attend pas.
    (
      t.provider as unknown as { projects: { ref: string; status: string }[] }
    ).projects.forEach(p => {
      if (p.ref === 'demo-crm-poc') p.status = 'INACTIVE';
    });
    await t.app.inject({
      method: 'GET',
      url: '/api/fleet?refresh=1',
      headers: { cookie },
    });
    await t.ctx.alerts.idle();
    expect(titlesFor(browser)).toEqual([
      'J-1 avant la fin de la fenêtre de restauration — CRM POC',
    ]);
    expect(MB).toBeGreaterThan(0);
  });

  it('une évaluation qui échoue est rapportée, la file continue', async () => {
    seedAccount();
    await withPush();
    const original = t.store.listAlertRecipients.bind(t.store);
    let calls = 0;
    t.store.listAlertRecipients = () => {
      calls += 1;
      if (calls === 1) throw new Error('base indisponible');
      return original();
    };
    t.ctx.alerts.enqueue(dbSizeEvent(0.99, '2026-09-10T10:00:00Z'));
    t.ctx.alerts.enqueue(dbSizeEvent(0.99, '2026-09-10T10:00:00Z'));
    await t.ctx.alerts.idle();
    expect(t.errors).toHaveLength(1);
    expect(calls).toBe(2);
  });
});
