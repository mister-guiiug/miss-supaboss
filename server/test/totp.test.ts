// @vitest-environment node
/**
 * Primitives TOTP, contre les vecteurs des RFC : si un seul chiffre diffère,
 * aucune application d'authentification ne tombera d'accord avec le serveur.
 */
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hotp,
  matchTotp,
  normalizeRecoveryCode,
  otpauthUri,
  totpCode,
  totpStep,
} from '../src/totp.ts';

/** « 12345678901234567890 », la graine des RFC 4226 et 6238 (SHA-1). */
const SEED = Buffer.from('12345678901234567890');
const SEED_B32 = base32Encode(SEED);

describe('base32 (RFC 4648)', () => {
  it('vecteurs de la RFC 4648, sans remplissage', () => {
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
  });

  it('tolère minuscules, espaces et « = », refuse un caractère étranger', () => {
    expect(base32Decode('mzxw 6ytb oi==').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow(/base32/);
  });

  it('un secret fait 20 octets (160 bits)', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });
});

describe('HOTP (RFC 4226, annexe D)', () => {
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ])('compteur %i → %s', (counter, code) => {
    expect(hotp(SEED, counter)).toBe(code);
  });
});

describe('TOTP (RFC 6238, annexe B, SHA-1, 6 derniers chiffres)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('T = %i s → %s', (seconds, code) => {
    expect(totpCode(SEED_B32, seconds * 1000)).toBe(code);
  });
});

describe('matchTotp — fenêtre et anti-rejeu', () => {
  const now = 1_700_000_000_000;
  const step = totpStep(now);
  const at = (delta: number): string =>
    totpCode(SEED_B32, now + delta * 30_000);

  it('accepte le pas courant et ±1, rend le pas reconnu', () => {
    expect(matchTotp(SEED_B32, at(0), { nowMs: now, lastStep: null })).toBe(
      step
    );
    expect(matchTotp(SEED_B32, at(-1), { nowMs: now, lastStep: null })).toBe(
      step - 1
    );
    expect(matchTotp(SEED_B32, at(1), { nowMs: now, lastStep: null })).toBe(
      step + 1
    );
  });

  it('refuse au-delà d’un pas de dérive', () => {
    expect(
      matchTotp(SEED_B32, at(2), { nowMs: now, lastStep: null })
    ).toBeNull();
    expect(
      matchTotp(SEED_B32, at(-2), { nowMs: now, lastStep: null })
    ).toBeNull();
  });

  it('REJEU : un code d’un pas déjà accepté est refusé, un plus récent passe', () => {
    expect(
      matchTotp(SEED_B32, at(0), { nowMs: now, lastStep: step })
    ).toBeNull();
    expect(
      matchTotp(SEED_B32, at(-1), { nowMs: now, lastStep: step })
    ).toBeNull();
    expect(matchTotp(SEED_B32, at(1), { nowMs: now, lastStep: step })).toBe(
      step + 1
    );
  });

  it('refuse ce qui n’est pas six chiffres', () => {
    for (const code of ['', '12345', '1234567', 'abcdef', ' 12345']) {
      expect(matchTotp(SEED_B32, code, { nowMs: now, lastStep: null })).toBe(
        null
      );
    }
  });
});

describe('URI otpauth://', () => {
  it('émetteur dans le libellé ET en paramètre, paramètres explicites', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'admin@local');
    expect(
      uri.startsWith('otpauth://totp/Miss%20Supaboss:admin%40local?')
    ).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(params.get('issuer')).toBe('Miss Supaboss');
    expect(params.get('algorithm')).toBe('SHA1');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});

describe('codes de secours', () => {
  it('dix codes distincts, lisibles, sans caractère ambigu', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    }
  });

  it('la saisie est normalisée : casse, tirets, espaces', () => {
    expect(normalizeRecoveryCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(normalizeRecoveryCode('ABCDE FGHJK')).toBe('ABCDEFGHJK');
  });
});
