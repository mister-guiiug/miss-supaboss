/**
 * Classification des erreurs de synchro compte (proxy / PAT / scopes) pour
 * afficher des CTA actionnables plutôt qu'un `lastError` brut.
 */
import { ApiError } from './types.ts';

export type SyncErrorKind = 'network' | 'pat' | 'scope' | 'unknown';

export function classifySyncError(
  error: unknown,
  fallbackMessage?: string | null
): { kind: SyncErrorKind; message: string } {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.code === 'network') {
      return { kind: 'network', message: error.message };
    }
    if (error.status === 401 || error.code === 'pat-invalid') {
      return { kind: 'pat', message: error.message };
    }
    if (
      error.status === 403 ||
      error.code === 'forbidden' ||
      error.code === 'pat-scope'
    ) {
      return { kind: 'scope', message: error.message };
    }
    return { kind: 'unknown', message: error.message };
  }
  const message =
    fallbackMessage?.trim() ||
    (error instanceof Error ? error.message : 'Erreur inconnue');
  const lower = message.toLowerCase();
  if (
    lower.includes('proxy') ||
    lower.includes('network') ||
    lower.includes('injoignable') ||
    lower.includes('failed to fetch')
  ) {
    return { kind: 'network', message };
  }
  if (
    lower.includes('401') ||
    lower.includes('expiré') ||
    lower.includes('expired') ||
    lower.includes('pat invalide') ||
    lower.includes('invalid')
  ) {
    return { kind: 'pat', message };
  }
  if (
    lower.includes('403') ||
    lower.includes('scope') ||
    lower.includes('portée') ||
    lower.includes('forbidden') ||
    lower.includes('permission')
  ) {
    return { kind: 'scope', message };
  }
  return { kind: 'unknown', message };
}

export function classifyLastError(
  lastError: string | null | undefined
): SyncErrorKind {
  if (!lastError) return 'unknown';
  return classifySyncError(null, lastError).kind;
}
