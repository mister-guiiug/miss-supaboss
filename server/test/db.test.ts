// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/db.ts';

let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
});

afterEach(() => {
  store.close();
});

describe('Store — utilisateurs & sessions', () => {
  it('crée, retrouve, supprime', () => {
    expect(store.countUsers()).toBe(0);
    const u = store.createUser('Admin@Local', 'hash', 'admin');
    expect(u.email).toBe('admin@local'); // normalisé
    expect(store.findUserByEmail('ADMIN@LOCAL')?.id).toBe(u.id);
    store.createSession('tok-hash', u.id, 1);
    expect(store.findSessionUser('tok-hash')?.id).toBe(u.id);
    store.deleteSession('tok-hash');
    expect(store.findSessionUser('tok-hash')).toBeNull();
  });

  it('ignore les sessions expirées', () => {
    const u = store.createUser('a@b.c', 'hash', 'viewer');
    store.createSession('expired', u.id, -1);
    expect(store.findSessionUser('expired')).toBeNull();
  });
});

describe('Store — observations projet', () => {
  const acc = () =>
    store.insertAccount({
      alias: 'lab',
      color: '#3ecf8e',
      patCipher: 'cipher',
      patHint: 'sbp_…aaaa',
    });

  it('actif → pause observée : pausedAt posé, retour actif : remis à null', () => {
    const a = acc();
    const first = store.observeProject(a.id, 'p1', 'ACTIVE_HEALTHY');
    expect(first.lastSeenActiveAt).not.toBeNull();
    expect(first.pausedAt).toBeNull();

    const paused = store.observeProject(a.id, 'p1', 'INACTIVE');
    expect(paused.pausedAt).not.toBeNull();

    const back = store.observeProject(a.id, 'p1', 'ACTIVE_HEALTHY');
    expect(back.pausedAt).toBeNull();
    expect(back.lastSeenActiveAt).not.toBeNull();
  });

  it('découvert déjà en pause : pausedAt reste inconnu (pas de date inventée)', () => {
    const a = acc();
    const meta = store.observeProject(a.id, 'p2', 'INACTIVE');
    expect(meta.pausedAt).toBeNull();
    // ré-observé en pause : toujours pas de date inventée
    expect(store.observeProject(a.id, 'p2', 'INACTIVE').pausedAt).toBeNull();
    // mais une pause déclenchée par NOUS pose une date certaine
    store.markPausedByUs(a.id, 'p2');
    expect(store.getProjectMeta(a.id, 'p2')?.pausedAt).not.toBeNull();
  });

  it('méta éditable : tags, favori, démo fréquente', () => {
    const a = acc();
    store.observeProject(a.id, 'p3', 'ACTIVE_HEALTHY');
    const meta = store.setProjectMeta(a.id, 'p3', {
      tags: ['poc', 'critique-demo'],
      favorite: true,
    });
    expect(meta?.tags).toEqual(['poc', 'critique-demo']);
    const reread = store.getProjectMeta(a.id, 'p3');
    expect(reread?.favorite).toBe(true);
    expect(reread?.demoFrequent).toBe(false);
  });
});

describe('Store — audit & métriques', () => {
  it('journalise et filtre les opérations', () => {
    const id = store.recordOperation({
      userEmail: 'op@local',
      action: 'project.pause',
      accountId: 'acc1',
      projectRef: 'p1',
      status: 'pending',
    });
    store.updateOperation(id, 'ok');
    store.recordOperation({
      userEmail: 'op@local',
      action: 'login',
      status: 'ok',
    });
    expect(store.listOperations(10)).toHaveLength(2);
    const filtered = store.listOperations(10, 'acc1');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.status).toBe('ok');
    expect(filtered[0]?.action).toBe('project.pause');
  });

  it('cache métriques : upsert + relecture typée', () => {
    const a = store.insertAccount({
      alias: 'lab',
      color: '#3ecf8e',
      patCipher: 'c',
      patHint: 'h',
    });
    store.upsertMetric(a.id, 'p1', {
      kind: 'dbSize',
      state: 'measured',
      value: 28_000_000,
      quota: 1,
      measuredAt: '2026-06-10T08:00:00Z',
    });
    store.upsertMetric(a.id, 'p1', {
      kind: 'dbSize',
      state: 'measured',
      value: 29_000_000,
      quota: 1,
      measuredAt: '2026-06-10T09:00:00Z',
    });
    const metrics = store.getMetrics(a.id, 'p1');
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.value).toBe(29_000_000);
  });
});
