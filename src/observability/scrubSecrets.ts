/**
 * Retire les PAT Supabase et les en-têtes Authorization d'un texte ou d'un
 * objet avant qu'ils ne partent vers Sentry. Le coffre local ne protège pas
 * un message d'erreur qui recopierait `sbp_…`.
 */

const SECRET_TEXT = /sbp_[A-Za-z0-9_-]+|Bearer\s+\S+/gi;

const REDACTED_KEYS = new Set([
  'authorization',
  'cookie',
  'pat',
  'password',
  'set-cookie',
]);

export function scrubSecrets(text: string): string {
  return text.replace(SECRET_TEXT, match =>
    match.toLowerCase().startsWith('bearer')
      ? 'Bearer [redacted]'
      : 'sbp_[redacted]'
  );
}

export function scrubUnknown(
  value: unknown,
  seen = new WeakSet<object>()
): unknown {
  if (typeof value === 'string') return scrubSecrets(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => scrubUnknown(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase())
      ? '[redacted]'
      : scrubUnknown(item, seen);
  }
  return out;
}
