import { describe, expect, it } from 'vitest';
import { daysUntilPatExpiry } from './patExpiry.ts';

const NOW = Date.parse('2026-11-01T12:00:00Z');

describe('daysUntilPatExpiry', () => {
  it('compte les jours restants, y compris un PAT déjà expiré', () => {
    expect(daysUntilPatExpiry('2026-11-10', NOW)).toBe(10);
    expect(daysUntilPatExpiry('2026-10-01', NOW)).toBeLessThan(0);
    expect(daysUntilPatExpiry(null, NOW)).toBeNull();
    expect(daysUntilPatExpiry('pas-une-date', NOW)).toBeNull();
  });
});
