import { describe, expect, it } from 'vitest';
import { FLEET_TTL_MS, isCacheFresh, readFleetCache } from './cache.ts';
import { buildProjectMeta, observeStatusTransition } from './observe.ts';

describe('cache', () => {
  it('isCacheFresh respecte le TTL', () => {
    const now = 1_000_000;
    expect(isCacheFresh(now - 5_000, FLEET_TTL_MS, now)).toBe(true);
    expect(isCacheFresh(now - 20_000, FLEET_TTL_MS, now)).toBe(false);
  });

  it('readFleetCache ignore si refresh', () => {
    const hit = readFleetCache({ value: 'x', at: Date.now() }, true);
    expect(hit).toBeNull();
  });
});

describe('observeStatusTransition', () => {
  it('initialise lastSeenActiveAt si actif', () => {
    const o = observeStatusTransition(
      null,
      'ACTIVE_HEALTHY',
      '2026-06-01T00:00:00.000Z'
    );
    expect(o.lastSeenActiveAt).toBe('2026-06-01T00:00:00.000Z');
    expect(o.pausedAt).toBeNull();
  });

  it('pose pausedAt à la transition vers INACTIVE', () => {
    const o = observeStatusTransition(
      {
        lastSeenActiveAt: '2026-05-01T00:00:00.000Z',
        pausedAt: null,
        lastStatus: 'ACTIVE_HEALTHY',
      },
      'INACTIVE',
      '2026-06-01T00:00:00.000Z'
    );
    expect(o.pausedAt).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('buildProjectMeta', () => {
  it('calcule restoreDeadline', () => {
    const meta = buildProjectMeta(
      { tags: [], favorite: false, demoFrequent: false, notes: '' },
      { lastSeenActiveAt: null, pausedAt: '2026-01-01T00:00:00.000Z' },
      90
    );
    expect(meta.restoreDeadline).not.toBeNull();
  });
});
