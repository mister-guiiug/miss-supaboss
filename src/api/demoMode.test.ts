import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isDemoOverride,
  isDemoSeed,
  MOCK_STORAGE_KEY,
  resetDemoData,
  setDemoMode,
  switchDemoMode,
} from './demoMode.ts';

// Le snapshot hors-ligne (IndexedDB) est hors-sujet ici : on le neutralise.
vi.mock('../offline/lastKnown.ts', () => ({
  clearSnapshot: vi.fn().mockResolvedValue(undefined),
}));

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

  it('switchDemoMode(true) active ET repart d’une démo neuve (reseed)', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    // Fixtures « sales » d’une démo précédente.
    localStorage.setItem(MOCK_STORAGE_KEY, '{"projects":[{"ref":"mute"}]}');

    await switchDemoMode(true);

    expect(isDemoOverride()).toBe(true); // démo activée
    expect(localStorage.getItem(MOCK_STORAGE_KEY)).toBeNull(); // fixtures purgées
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('switchDemoMode(false) désactive ET ne laisse aucune donnée fictive', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    setDemoMode(true);
    localStorage.setItem(MOCK_STORAGE_KEY, '{"projects":[{"ref":"mute"}]}');

    await switchDemoMode(false);

    expect(isDemoOverride()).toBe(false); // démo désactivée
    expect(localStorage.getItem(MOCK_STORAGE_KEY)).toBeNull(); // rien de résiduel
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('isDemoSeed : ON par défaut, OFF si drapeau = "0"', () => {
    // Par défaut, les données d'exemple sont chargées (mise en avant).
    expect(isDemoSeed()).toBe(true);
    localStorage.setItem('miss-supaboss-demo-seed', '0');
    expect(isDemoSeed()).toBe(false);
    localStorage.setItem('miss-supaboss-demo-seed', '1');
    expect(isDemoSeed()).toBe(true);
  });
});
