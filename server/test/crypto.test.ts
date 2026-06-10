// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  generateMasterKey,
  hashPassword,
  hashToken,
  newSessionToken,
  openSecret,
  openWithPassphrase,
  sealSecret,
  sealWithPassphrase,
  secretHint,
  verifyPassword,
} from '../src/crypto.ts';

describe('chiffrement des PAT (AES-256-GCM)', () => {
  it('round-trip et non-déterminisme (IV aléatoire)', () => {
    const key = generateMasterKey();
    const pat = 'sbp_FAKETESTFAKETESTFAKETESTFAKETESTFAKETEST';
    const a = sealSecret(pat, key);
    const b = sealSecret(pat, key);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:/);
    expect(a).not.toContain(pat);
    expect(openSecret(a, key)).toBe(pat);
  });

  it('refuse une mauvaise clé ou un blob altéré', () => {
    const key = generateMasterKey();
    const blob = sealSecret('sbp_secret_value_123456', key);
    expect(() => openSecret(blob, generateMasterKey())).toThrow();
    expect(() => openSecret(blob.slice(0, -4) + 'AAAA', key)).toThrow();
    expect(() => openSecret('v2:x:y:z', key)).toThrow();
  });

  it('hint : jamais plus que le préfixe et 4 caractères', () => {
    expect(secretHint('sbp_0123456789abcdefedcba')).toBe('sbp_…dcba');
    expect(secretHint('autre-format-token')).toBe('…oken');
  });
});

describe('mots de passe (scrypt)', () => {
  it('vérifie le bon mot de passe et rejette le mauvais', () => {
    const stored = hashPassword('Tr0p-secret!');
    expect(stored).toMatch(/^scrypt:/);
    expect(verifyPassword('Tr0p-secret!', stored)).toBe(true);
    expect(verifyPassword('tr0p-secret!', stored)).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('sessions', () => {
  it('tokens opaques, uniques, hash stable', () => {
    const t1 = newSessionToken();
    const t2 = newSessionToken();
    expect(t1).not.toBe(t2);
    expect(hashToken(t1)).toBe(hashToken(t1));
    expect(hashToken(t1)).not.toBe(hashToken(t2));
  });
});

describe('export chiffré par passphrase', () => {
  it('round-trip, mauvaise passphrase rejetée', () => {
    const payload = JSON.stringify([
      { alias: 'lab', pat: 'sbp_aaaa1111bbbb2222cccc' },
    ]);
    const blob = sealWithPassphrase(payload, 'ma-passphrase-export');
    expect(blob).toMatch(/^supaboss-export-v1:/);
    expect(blob).not.toContain('sbp_');
    expect(openWithPassphrase(blob, 'ma-passphrase-export')).toBe(payload);
    expect(() => openWithPassphrase(blob, 'mauvaise')).toThrow();
  });
});
