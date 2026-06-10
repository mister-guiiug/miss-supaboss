import { beforeEach, describe, expect, it } from 'vitest';
import {
  FORCED_MOCK,
  isDemoOverride,
  MOCK_STORAGE_KEY,
  resetDemoData,
  setDemoMode,
} from './demoMode.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('mode démo (surcharge runtime)', () => {
  it('hors build Pages, le mock n’est pas forcé', () => {
    expect(FORCED_MOCK).toBe(false);
  });

  it('setDemoMode pose et retire le drapeau persistant', () => {
    expect(isDemoOverride()).toBe(false);
    setDemoMode(true);
    expect(isDemoOverride()).toBe(true);
    expect(localStorage.getItem('miss-supaboss-demo-mode')).toBe('1');
    setDemoMode(false);
    expect(isDemoOverride()).toBe(false);
    expect(localStorage.getItem('miss-supaboss-demo-mode')).toBeNull();
  });

  it('resetDemoData purge l’état des fixtures, pas le drapeau', () => {
    setDemoMode(true);
    localStorage.setItem(MOCK_STORAGE_KEY, '{"projects":[]}');
    resetDemoData();
    expect(localStorage.getItem(MOCK_STORAGE_KEY)).toBeNull();
    expect(isDemoOverride()).toBe(true);
  });
});
