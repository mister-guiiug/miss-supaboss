/**
 * Estimation grossière d’entropie pour guider le choix d’une phrase coffre.
 * Ce n’est PAS un audit crypto — juste un frein UX aux phrases trop courtes.
 */

export type PassphraseStrength = 'weak' | 'fair' | 'good' | 'strong';

/** Minimum accepté à l’activation du coffre / export (caractères). */
export const PASSPHRASE_MIN_LENGTH = 12;

export function scorePassphrase(passphrase: string): {
  strength: PassphraseStrength;
  score: number;
} {
  const len = passphrase.length;
  if (len === 0) return { strength: 'weak', score: 0 };

  let classes = 0;
  if (/[a-z]/.test(passphrase)) classes += 1;
  if (/[A-Z]/.test(passphrase)) classes += 1;
  if (/\d/.test(passphrase)) classes += 1;
  if (/[^A-Za-z0-9]/.test(passphrase)) classes += 1;

  // Mots séparés (passphrase) comptent plus qu’une chaîne compacte courte.
  const words = passphrase.trim().split(/\s+/).filter(Boolean).length;
  let score = Math.min(40, len * 2) + classes * 12 + Math.min(20, words * 5);

  if (len < PASSPHRASE_MIN_LENGTH) score = Math.min(score, 35);
  if (
    /^(.)\1+$/.test(passphrase) ||
    /^(012|123|abc|password|azerty)/i.test(passphrase)
  ) {
    score = Math.min(score, 25);
  }

  const strength: PassphraseStrength =
    score >= 85
      ? 'strong'
      : score >= 65
        ? 'good'
        : score >= 45
          ? 'fair'
          : 'weak';
  return { strength, score: Math.min(100, score) };
}

export function isPassphraseAcceptable(passphrase: string): boolean {
  return (
    passphrase.length >= PASSPHRASE_MIN_LENGTH &&
    scorePassphrase(passphrase).strength !== 'weak'
  );
}
