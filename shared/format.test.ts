import { describe, expect, it } from 'vitest';
import { GB, MB } from './quotas.ts';
import {
  formatBytes,
  formatCount,
  formatPercent,
  formatRelative,
  formatUsage,
} from './format.ts';

describe('formatBytes', () => {
  it('rend les libellés type dashboard Supabase', () => {
    expect(formatBytes(31 * MB)).toBe('31 MB');
    expect(formatBytes(5 * GB)).toBe('5 GB');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1,5 kB');
  });
  it('— pour une valeur invalide', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatCount', () => {
  it('compacte k / M', () => {
    expect(formatCount(2)).toBe('2');
    expect(formatCount(50_000)).toBe('50k');
    expect(formatCount(1_230)).toBe('1,2k');
    expect(formatCount(2_500_000)).toBe('2,5M');
  });
});

describe('formatUsage', () => {
  it('« consommé / quota » avec — quand inconnu', () => {
    expect(formatUsage(31 * MB, 5 * GB, true)).toBe('31 MB / 5 GB');
    expect(formatUsage(2, 50_000, false)).toBe('2 / 50k');
    expect(formatUsage(null, 5 * GB, true)).toBe('— / 5 GB');
  });
});

describe('formatPercent', () => {
  it('arrondit lisiblement', () => {
    expect(formatPercent(0.62)).toBe('62 %');
    expect(formatPercent(0.062)).toBe('6,2 %');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-06-10T12:00:00Z');
  it('échelles min/h/j', () => {
    expect(formatRelative('2026-06-10T11:58:00Z', now)).toBe('il y a 2 min');
    expect(formatRelative('2026-06-10T09:00:00Z', now)).toBe('il y a 3 h');
    expect(formatRelative('2026-06-08T12:00:00Z', now)).toBe('il y a 2 j');
    expect(formatRelative(null, now)).toBe('jamais');
  });
});
