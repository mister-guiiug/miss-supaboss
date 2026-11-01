/**
 * Coffre PAT (chiffrement au repos opt-in) : aller-retour AES-GCM, vérification
 * de la phrase au déverrouillage, persistance des métadonnées entre sessions,
 * lockout après trop d’échecs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { patVault } from './patVault.ts';

const VAULT_META_KEY = 'miss-supaboss-vault-v1';
const GOOD = 'correct horse battery staple';

beforeEach(() => {
  patVault.disable();
  localStorage.clear();
});

describe('patVault — coffre AES-GCM/PBKDF2', () => {
  it('désactivé et verrouillé par défaut', () => {
    expect(patVault.isEnabled()).toBe(false);
    expect(patVault.isUnlocked()).toBe(false);
  });

  it('refuse une phrase trop faible à l’activation', async () => {
    await expect(patVault.enable('court')).rejects.toThrow('passphrase-weak');
  });

  it('enable → aller-retour chiffré + métadonnées persistées', async () => {
    await patVault.enable(GOOD);
    expect(patVault.isEnabled()).toBe(true);
    expect(patVault.isUnlocked()).toBe(true);

    const blob = await patVault.encrypt('sbp_secrettoken');
    expect(blob).not.toContain('sbp_secrettoken');
    expect(await patVault.decrypt(blob)).toBe('sbp_secrettoken');
    expect(localStorage.getItem(VAULT_META_KEY)).toBeTruthy();
  });

  it('unlock : bonne phrase OK, mauvaise phrase rejetée', async () => {
    await patVault.enable(GOOD);
    const blob = await patVault.encrypt('sbp_x');
    patVault.lock();
    expect(patVault.isUnlocked()).toBe(false);

    expect(await patVault.unlock('mauvaise-phrase-xx')).toBe(false);
    expect(patVault.isUnlocked()).toBe(false);

    expect(await patVault.unlock(GOOD)).toBe(true);
    expect(patVault.isUnlocked()).toBe(true);
    expect(await patVault.decrypt(blob)).toBe('sbp_x');
  });

  it('lockout après 5 échecs', async () => {
    await patVault.enable(GOOD);
    patVault.lock();
    for (let i = 0; i < 5; i++) {
      expect(await patVault.unlock('wrong-passphrase!')).toBe(false);
    }
    expect(patVault.lockoutRemainingMs()).toBeGreaterThan(0);
    expect(await patVault.unlock(GOOD)).toBe(false);
  });

  it('encrypt/decrypt refusent quand le coffre est verrouillé', async () => {
    await patVault.enable(GOOD);
    patVault.lock();
    await expect(patVault.encrypt('x')).rejects.toThrow('vault-locked');
    await expect(patVault.decrypt('AAAAAAAAAAAAAAAA')).rejects.toThrow(
      'vault-locked'
    );
  });

  it('survit à un « rechargement » puis re-déverrouille', async () => {
    await patVault.enable(GOOD);
    const blob = await patVault.encrypt('sbp_persist');
    patVault.lock();

    expect(patVault.isEnabled()).toBe(true);
    expect(patVault.isUnlocked()).toBe(false);
    expect(await patVault.unlock(GOOD)).toBe(true);
    expect(await patVault.decrypt(blob)).toBe('sbp_persist');
  });

  it('disable retire les métadonnées et la clé', async () => {
    await patVault.enable(GOOD);
    patVault.disable();
    expect(patVault.isEnabled()).toBe(false);
    expect(patVault.isUnlocked()).toBe(false);
    expect(localStorage.getItem(VAULT_META_KEY)).toBeNull();
  });
});
