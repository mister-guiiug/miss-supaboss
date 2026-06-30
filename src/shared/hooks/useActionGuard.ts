import { useMemo } from 'react';
import { useFleetStore } from '../../store/useFleetStore.ts';
import {
  canAdmin,
  canOperate,
  useSessionStore,
} from '../../store/useSessionStore.ts';
import { useOnline } from './useOnline.ts';

export interface ActionGuardOptions {
  online?: boolean;
  operate?: boolean;
  admin?: boolean;
  /** Exige des données live (pas le cache hors-ligne). */
  writable?: boolean;
}

export interface ActionGuardResult {
  allowed: boolean;
  reason: string | null;
  disabled: boolean;
  /** Props à étaler sur un bouton désactivable. */
  disabledProps: { disabled: boolean; 'aria-disabled'?: true };
  wrap: <T extends (...args: never[]) => unknown>(fn: T) => T;
}

const REASONS = {
  offline: 'Connexion requise',
  readonly: 'Lecture seule (hors ligne)',
  operate: 'Droits opérateur requis',
  admin: 'Droits administrateur requis',
} as const;

export function useActionGuard(
  options: ActionGuardOptions = {}
): ActionGuardResult {
  const online = useOnline();
  const fromCache = useFleetStore(s => s.fromCache);
  const user = useSessionStore(s => s.user);

  return useMemo(() => {
    let reason: string | null = null;

    if (options.online && !online) reason = REASONS.offline;
    else if (options.writable && fromCache) reason = REASONS.readonly;
    else if (options.operate && !canOperate(user)) reason = REASONS.operate;
    else if (options.admin && !canAdmin(user)) reason = REASONS.admin;

    const allowed = reason === null;

    const wrap = <T extends (...args: never[]) => unknown>(fn: T): T =>
      ((...args: Parameters<T>) => {
        if (!allowed) return undefined;
        return fn(...args);
      }) as T;

    return {
      allowed,
      reason,
      disabled: !allowed,
      disabledProps: allowed
        ? { disabled: false }
        : { disabled: true, 'aria-disabled': true as const },
      wrap,
    };
  }, [
    online,
    fromCache,
    user,
    options.online,
    options.writable,
    options.operate,
    options.admin,
  ]);
}
