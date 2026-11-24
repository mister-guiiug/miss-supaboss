import { describe, expect, it } from 'vitest';
import type { AccountFleetDto, ProjectDto } from './contracts.ts';
import {
  accountSummary,
  collectTags,
  fleetTotals,
  mainMetric,
  restoreCountdown,
  restoreWatchlist,
  sortByUrgency,
  tagLabel,
  urgencyRank,
} from './overview.ts';
import {
  DEFAULT_THRESHOLDS,
  FREE_PLAN_QUOTAS,
  type MetricValue,
} from './quotas.ts';

const NOW = new Date('2026-11-24T12:00:00Z');
const DAY = 86_400_000;
const inDays = (days: number) =>
  new Date(NOW.getTime() + days * DAY).toISOString();

function project(over: Partial<ProjectDto> & { ref: string }): ProjectDto {
  const { meta, ...rest } = over;
  return {
    accountId: 'acc',
    name: over.ref,
    region: 'eu-west-3',
    organizationSlug: 'org',
    organizationName: 'Org',
    status: 'ACTIVE_HEALTHY',
    createdAt: inDays(-400),
    ...rest,
    meta: {
      tags: [],
      favorite: false,
      demoFrequent: false,
      notes: '',
      lastSeenActiveAt: null,
      pausedAt: null,
      restoreDeadline: null,
      ...meta,
    },
  };
}

const paused = (ref: string, deadlineInDays: number | null) =>
  project({
    ref,
    status: 'INACTIVE',
    meta: {
      tags: [],
      favorite: false,
      demoFrequent: false,
      notes: '',
      lastSeenActiveAt: null,
      pausedAt: inDays(-10),
      restoreDeadline: deadlineInDays === null ? null : inDays(deadlineInDays),
    },
  });

function db(ratio: number): MetricValue {
  const quota = FREE_PLAN_QUOTAS.dbSize;
  return {
    kind: 'dbSize',
    state: 'measured',
    value: ratio * quota,
    quota,
    measuredAt: NOW.toISOString(),
  };
}

describe('restoreCountdown', () => {
  it('compte les jours restants, arrondis au supérieur', () => {
    expect(restoreCountdown(paused('a', 5), NOW)).toMatchObject({
      days: 5,
      urgency: 'urgent',
    });
    expect(restoreCountdown(paused('b', 4.2), NOW)?.days).toBe(5);
  });

  it('classe urgent sous 7 jours, proche sous 30, plus tard au-delà', () => {
    expect(restoreCountdown(paused('a', 7), NOW)?.urgency).toBe('urgent');
    expect(restoreCountdown(paused('b', 8), NOW)?.urgency).toBe('soon');
    expect(restoreCountdown(paused('c', 30), NOW)?.urgency).toBe('soon');
    expect(restoreCountdown(paused('d', 31), NOW)?.urgency).toBe('later');
  });

  it('dit la fenêtre close une fois l’échéance passée, ou sur refus de l’API', () => {
    expect(restoreCountdown(paused('a', -1), NOW)?.urgency).toBe('expired');
    const blocked = paused('b', 200);
    blocked.meta.restoreDeadlineSource = 'api-blocked';
    expect(restoreCountdown(blocked, NOW)?.urgency).toBe('expired');
  });

  it('ne rend rien pour un projet qui tourne, ni sans date connue', () => {
    expect(restoreCountdown(project({ ref: 'a' }), NOW)).toBeNull();
    expect(restoreCountdown(paused('b', null), NOW)).toBeNull();
  });
});

describe('mainMetric', () => {
  it('prend la jauge la plus remplie et ignore ce qui ne se mesure pas', () => {
    const egress: MetricValue = {
      kind: 'egress',
      state: 'unavailable',
      value: null,
      quota: FREE_PLAN_QUOTAS.egress,
      measuredAt: null,
    };
    const mau: MetricValue = {
      kind: 'mau',
      state: 'estimated',
      value: 100,
      quota: FREE_PLAN_QUOTAS.mau,
      measuredAt: null,
    };
    expect(mainMetric([egress, mau, db(0.72)])?.kind).toBe('dbSize');
    expect(mainMetric([egress])).toBeNull();
    expect(mainMetric([])).toBeNull();
  });
});

describe('urgencyRank et sortByUrgency', () => {
  it('met l’erreur, puis l’échéance urgente, puis le quota critique devant', () => {
    const t = DEFAULT_THRESHOLDS;
    expect(
      urgencyRank(project({ ref: 'e', status: 'PAUSE_FAILED' }), [], t, NOW)
    ).toBe(0);
    expect(urgencyRank(paused('u', 3), [], t, NOW)).toBe(1);
    expect(
      urgencyRank(project({ ref: 'r', status: 'RESTORING' }), [], t, NOW)
    ).toBe(2);
    expect(urgencyRank(project({ ref: 'q' }), [db(0.98)], t, NOW)).toBe(3);
    expect(urgencyRank(paused('s', 20), [], t, NOW)).toBe(4);
    expect(urgencyRank(paused('x', -2), [], t, NOW)).toBe(7);
    expect(urgencyRank(project({ ref: 'calme' }), [db(0.1)], t, NOW)).toBe(9);
  });

  it('départage par échéance, puis par jauge, puis par nom', () => {
    const metrics: Record<string, MetricValue[]> = {
      plein: [db(0.9)],
      moyen: [db(0.75)],
    };
    const sorted = sortByUrgency(
      [
        project({ ref: 'zeta' }),
        paused('loin', 25),
        project({ ref: 'moyen' }),
        paused('proche', 12),
        project({ ref: 'alpha' }),
        project({ ref: 'plein' }),
      ],
      p => metrics[p.ref] ?? [],
      DEFAULT_THRESHOLDS,
      NOW
    );
    expect(sorted.map(p => p.ref)).toEqual([
      'proche',
      'loin',
      'plein',
      'moyen',
      'alpha',
      'zeta',
    ]);
  });
});

describe('accountSummary et fleetTotals', () => {
  const lab: AccountFleetDto = {
    account: {
      id: 'lab',
      alias: 'Lab',
      color: '#3ecf8e',
      enabled: true,
      patHint: 'sbp_…a1b2',
      createdAt: inDays(-100),
      lastSyncAt: null,
      lastError: null,
    },
    organizations: [],
    projects: [
      project({ ref: 'a' }),
      project({ ref: 'b', status: 'COMING_UP' }),
      paused('c', 5),
      paused('d', 200),
    ],
    syncedAt: null,
  };
  const off: AccountFleetDto = {
    ...lab,
    account: { ...lab.account, id: 'off', enabled: false },
    projects: [paused('e', 3)],
  };

  it('compte les places prises, libres et les projets en pause', () => {
    expect(accountSummary(lab)).toEqual({
      active: 2,
      limit: 2,
      free: 0,
      paused: 2,
      total: 4,
    });
    expect(accountSummary(off).free).toBe(2);
  });

  it('n’offre de places que pour les comptes activés', () => {
    expect(fleetTotals({ accounts: [lab, off] }, NOW)).toEqual({
      projects: 5,
      active: 2,
      slots: 2,
      paused: 3,
      restoreUrgent: 2,
    });
  });
});

describe('restoreWatchlist', () => {
  it('garde les échéances sous 30 jours, la plus proche d’abord, sans les closes', () => {
    const list = restoreWatchlist(
      [paused('loin', 90), paused('b', 20), paused('a', 2), paused('x', -1)],
      NOW
    );
    expect(list.map(e => e.project.ref)).toEqual(['a', 'b']);
  });
});

describe('étiquettes', () => {
  it('retire le préfixe de démo du libellé, et trie sans doublon', () => {
    expect(tagLabel('démo:archive')).toBe('archive');
    expect(tagLabel('prod')).toBe('prod');
    const tags = collectTags([
      project({
        ref: 'a',
        meta: {
          tags: ['démo:poc', 'démo:demo'],
          favorite: false,
          demoFrequent: false,
          notes: '',
          lastSeenActiveAt: null,
          pausedAt: null,
          restoreDeadline: null,
        },
      }),
      project({
        ref: 'b',
        meta: {
          tags: ['démo:demo', 'archive'],
          favorite: false,
          demoFrequent: false,
          notes: '',
          lastSeenActiveAt: null,
          pausedAt: null,
          restoreDeadline: null,
        },
      }),
    ]);
    expect(tags).toEqual(['archive', 'démo:demo', 'démo:poc']);
  });
});
