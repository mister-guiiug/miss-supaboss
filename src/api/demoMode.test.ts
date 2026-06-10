import { beforeEach, describe, expect, it } from 'vitest';
import {
  isDemoOverride,
  MOCK_STORAGE_KEY,
  resetDemoData,
  setDemoMode,
} from './demoMode.ts';

// NB : FORCED_MOCK n'est pas testé — il reflète VITE_MOCK au build
// (la CI famille injecte VITE_MOCK=1 avant build ET tests).

beforeEach(() => {
  localStorage.clear();
});

describe('mode démo (surcharge runtime)', () => {
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
