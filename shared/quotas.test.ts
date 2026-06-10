import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  FREE_PLAN_QUOTAS,
  GB,
  MB,
  quotaLevel,
  sumMetrics,
  unavailableMetric,
  usageRatio,
  worstLevel,
  type MetricValue,
} from './quotas.ts';

function metric(over: Partial<MetricValue>): MetricValue {
  return {
    kind: 'dbSize',
    state: 'measured',
    value: 28 * MB,
    quota: FREE_PLAN_QUOTAS.dbSize,
    measuredAt: '2026-06-10T08:00:00Z',
    ...over,
  };
}

describe('usageRatio / quotaLevel', () => {
  it('calcule le ratio et le niveau ok', () => {
    const m = metric({});
    expect(usageRatio(m)).toBeCloseTo(28 / 500, 3);
    expect(quotaLevel(m)).toBe('ok');
  });

  it('franchit warn/high/critical selon les seuils', () => {
    expect(quotaLevel(metric({ value: 360 * MB }))).toBe('warn'); // 72 %
    expect(quotaLevel(metric({ value: 440 * MB }))).toBe('high'); // 88 %
    expect(quotaLevel(metric({ value: 490 * MB }))).toBe('critical'); // 98 %
  });

  it('respecte des seuils personnalisés', () => {
    const strict = { warn: 10, high: 50, critical: 90 };
    expect(quotaLevel(metric({ value: 100 * MB }), strict)).toBe('warn');
  });

  it('null pour une métrique indisponible (jamais de valeur inventée)', () => {
    const m = unavailableMetric('egress');
    expect(m.value).toBeNull();
    expect(m.quota).toBe(5 * GB);
    expect(usageRatio(m)).toBeNull();
    expect(quotaLevel(m)).toBeNull();
  });
});

describe('worstLevel', () => {
  it('retourne le pire niveau mesurable', () => {
    const level = worstLevel(
      [
        metric({}),
        metric({ kind: 'storage', value: 0.97 * GB, quota: 1 * GB }),
      ],
      DEFAULT_THRESHOLDS
    );
    expect(level).toBe('critical');
  });

  it('null si rien n’est mesurable', () => {
    expect(worstLevel([unavailableMetric('egress')])).toBeNull();
  });
});

describe('sumMetrics', () => {
  it('somme les valeurs et garde l’état le moins fiable', () => {
    const sum = sumMetrics('dbSize', [
      metric({
        value: 100 * MB,
        state: 'measured',
        measuredAt: '2026-06-10T08:00:00Z',
      }),
      metric({
        value: 50 * MB,
        state: 'stale',
        measuredAt: '2026-06-08T08:00:00Z',
      }),
    ]);
    expect(sum.value).toBe(150 * MB);
    expect(sum.state).toBe('stale');
    expect(sum.measuredAt).toBe('2026-06-08T08:00:00Z'); // la plus ancienne
  });

  it('indisponible si aucune valeur', () => {
    expect(sumMetrics('egress', [unavailableMetric('egress')]).state).toBe(
      'unavailable'
    );
  });
});
