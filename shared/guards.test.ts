import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PROJECT_LIMIT,
  activeProjects,
  estimateRestoreDeadline,
  evaluateRestore,
  isRestoreWindowExpired,
  suggestPauses,
  type ProjectLite,
} from './guards.ts';

function p(over: Partial<ProjectLite> & { ref: string }): ProjectLite {
  return {
    name: over.ref,
    status: 'ACTIVE_HEALTHY',
    favorite: false,
    demoFrequent: false,
    tags: [],
    lastSeenActiveAt: null,
    ...over,
  };
}

describe('activeProjects', () => {
  it('compte ACTIVE_*, transitions montantes et PAUSING (conservateur)', () => {
    const list = [
      p({ ref: 'a', status: 'ACTIVE_HEALTHY' }),
      p({ ref: 'b', status: 'RESTORING' }),
      p({ ref: 'c', status: 'PAUSING' }),
      p({ ref: 'd', status: 'INACTIVE' }),
      p({ ref: 'e', status: 'REMOVED' }),
    ];
    expect(activeProjects(list).map(x => x.ref)).toEqual(['a', 'b', 'c']);
  });
});

describe('evaluateRestore', () => {
  it('autorise quand un slot est libre', () => {
    const res = evaluateRestore(
      [
        p({ ref: 'on', status: 'ACTIVE_HEALTHY' }),
        p({ ref: 'off', status: 'INACTIVE' }),
      ],
      'off'
    );
    expect(res).toMatchObject({ allowed: true, reason: 'ok', activeCount: 1 });
  });

  it('refuse avec suggestions quand la limite Free est atteinte', () => {
    const res = evaluateRestore(
      [
        p({ ref: 'fav', status: 'ACTIVE_HEALTHY', favorite: true }),
        p({
          ref: 'old',
          status: 'ACTIVE_HEALTHY',
          lastSeenActiveAt: '2026-01-01T00:00:00Z',
        }),
        p({ ref: 'target', status: 'INACTIVE' }),
      ],
      'target'
    );
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('limit-reached');
    expect(res.activeCount).toBe(ACTIVE_PROJECT_LIMIT);
    // Le non-favori le plus anciennement actif est suggéré en premier.
    expect(res.suggestions.map(s => s.ref)).toEqual(['old']);
  });

  it('signale un projet déjà actif ou non restaurable', () => {
    const list = [
      p({ ref: 'up', status: 'ACTIVE_HEALTHY' }),
      p({ ref: 'gone', status: 'REMOVED' }),
    ];
    expect(evaluateRestore(list, 'up').reason).toBe('already-active');
    expect(evaluateRestore(list, 'gone').reason).toBe('not-restorable');
    expect(evaluateRestore(list, 'nope').reason).toBe('unknown-project');
  });

  it('RESTORE_FAILED reste restaurable (retry)', () => {
    const res = evaluateRestore(
      [p({ ref: 'x', status: 'RESTORE_FAILED' })],
      'x'
    );
    expect(res.allowed).toBe(true);
  });
});

describe('suggestPauses', () => {
  it('épargne favoris, démos fréquentes et critique-demo', () => {
    const actives = [
      p({ ref: 'crit', tags: ['critique-demo'] }),
      p({ ref: 'fav', favorite: true }),
      p({ ref: 'demo', demoFrequent: true }),
      p({ ref: 'plain' }),
    ];
    expect(suggestPauses(actives, 2).map(s => s.ref)).toEqual(['plain', 'fav']);
  });

  it('à coût égal, le plus anciennement actif sort en premier', () => {
    const actives = [
      p({ ref: 'recent', lastSeenActiveAt: '2026-06-09T00:00:00Z' }),
      p({ ref: 'ancien', lastSeenActiveAt: '2026-05-01T00:00:00Z' }),
    ];
    expect(suggestPauses(actives, 1).map(s => s.ref)).toEqual(['ancien']);
  });
});

describe('fenêtre de restaurabilité', () => {
  it('échéance = pausedAt + 90 j par défaut', () => {
    const deadline = estimateRestoreDeadline('2026-01-01T00:00:00.000Z');
    expect(deadline).toBe('2026-04-01T00:00:00.000Z');
  });

  it('null si pausedAt inconnu ou invalide', () => {
    expect(estimateRestoreDeadline(null)).toBeNull();
    expect(estimateRestoreDeadline('n/a')).toBeNull();
  });

  it('détecte une fenêtre expirée', () => {
    const now = new Date('2026-06-10T00:00:00Z');
    expect(isRestoreWindowExpired('2026-06-01T00:00:00Z', now)).toBe(true);
    expect(isRestoreWindowExpired('2026-07-01T00:00:00Z', now)).toBe(false);
    expect(isRestoreWindowExpired(null, now)).toBe(false);
  });
});
