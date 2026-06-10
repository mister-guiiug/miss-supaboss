import { describe, expect, it } from 'vitest';
import {
  SUPABASE_PROJECT_STATUSES,
  STATUS_LABELS,
  countsTowardActiveLimit,
  isPausable,
  isRestorable,
  statusGroup,
} from './status.ts';

describe('statuts Supabase', () => {
  it('chaque statut a un groupe et un libellé', () => {
    for (const s of SUPABASE_PROJECT_STATUSES) {
      expect(statusGroup(s)).toBeTruthy();
      expect(STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it('groupes clés', () => {
    expect(statusGroup('ACTIVE_HEALTHY')).toBe('active');
    expect(statusGroup('INACTIVE')).toBe('paused');
    expect(statusGroup('RESTORING')).toBe('transition');
    expect(statusGroup('RESTORE_FAILED')).toBe('error');
    expect(statusGroup('UNKNOWN')).toBe('unknown');
  });

  it('transitions actionnables', () => {
    expect(isPausable('ACTIVE_HEALTHY')).toBe(true);
    expect(isPausable('INACTIVE')).toBe(false);
    expect(isRestorable('INACTIVE')).toBe(true);
    expect(isRestorable('ACTIVE_HEALTHY')).toBe(false);
    expect(countsTowardActiveLimit('PAUSING')).toBe(true);
    expect(countsTowardActiveLimit('INACTIVE')).toBe(false);
  });
});
