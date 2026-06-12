/**
 * Coffre PAT (chiffrement au repos opt-in) : aller-retour AES-GCM, vérification
 * de la phrase au déverrouillage, persistance des métadonnées entre sessions.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { patVault } from './patVault.ts';

const VAULT_META_KEY = 'miss-supaboss-vault-v1';

beforeEach(() => {
  // État propre : la clé mémoire est un singleton de module, les métadonnées
  // vivent dans localStorage.
  patVault.disable();
  localStorage.clear();
});

describe('patVault — coffre AES-GCM/PBKDF2', () => {
  it('désactivé et verrouillé par défaut', () => {
    expect(patVault.isEnabled()).toBe(false);
    expect(patVault.isUnlocked()).toBe(false);
  });

  it('enable → aller-retour chiffré + métadonnées persistées', async () => {
    await patVault.enable('correct horse battery staple');
    expect(patVault.isEnabled()).toBe(true);
    expect(patVault.isUnlocked()).toBe(true);

    const blob = await patVault.encrypt('sbp_secrettoken');
    expect(blob).not.toContain('sbp_secrettoken'); // jamais en clair
    expect(await patVault.decrypt(blob)).toBe('sbp_secrettoken');
    expect(localStorage.getItem(VAULT_META_KEY)).toBeTruthy();
  });

  it('unlock : bonne phrase OK, mauvaise phrase rejetée', async () => {
    await patVault.enable('bonne-phrase');
    const blob = await patVault.encrypt('sbp_x');
    patVault.lock();
    expect(patVault.isUnlocked()).toBe(false);

    expect(await patVault.unlock('mauvaise')).toBe(false);
    expect(patVault.isUnlocked()).toBe(false);

    expect(await patVault.unlock('bonne-phrase')).toBe(true);
    expect(patVault.isUnlocked()).toBe(true);
    expect(await patVault.decrypt(blob)).toBe('sbp_x');
  });

  it('encrypt/decrypt refusent quand le coffre est verrouillé', async () => {
    await patVault.enable('phrase');
    patVault.lock();
    await expect(patVault.encrypt('x')).rejects.toThrow('vault-locked');
    await expect(patVault.decrypt('AAAAAAAAAAAAAAAA')).rejects.toThrow(
      'vault-locked'
    );
  });

  it('survit à un « rechargement » (métadonnées seules) puis re-déverrouille', async () => {
    await patVault.enable('phrase-longue');
    const blob = await patVault.encrypt('sbp_persist');
    patVault.lock(); // perte de la clé mémoire, métadonnées conservées

    expect(patVault.isEnabled()).toBe(true);
    expect(patVault.isUnlocked()).toBe(false);
    expect(await patVault.unlock('phrase-longue')).toBe(true);
    expect(await patVault.decrypt(blob)).toBe('sbp_persist');
  });

  it('disable retire les métadonnées et la clé', async () => {
    await patVault.enable('phrase');
    patVault.disable();
    expect(patVault.isEnabled()).toBe(false);
    expect(patVault.isUnlocked()).toBe(false);
    expect(localStorage.getItem(VAULT_META_KEY)).toBeNull();
  });
});
