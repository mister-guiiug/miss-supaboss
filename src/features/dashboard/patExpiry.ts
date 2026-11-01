/** Jours avant l'échéance PAT (négatif = déjà expiré). `null` si date absente. */
export function daysUntilPatExpiry(
  patExpiresAt: string | null | undefined,
  now = Date.now()
): number | null {
  if (!patExpiresAt) return null;
  const end = Date.parse(`${patExpiresAt}T23:59:59`);
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - now) / 86_400_000);
}

export const PAT_EXPIRY_HORIZON_DAYS = 14;
