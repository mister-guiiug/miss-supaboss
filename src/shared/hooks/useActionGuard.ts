import { useMemo } from 'react';
import { useFleetStore } from '../../store/useFleetStore.ts';
import {
  canAdmin,
  canOperate,
  useSessionStore,
} from '../../store/useSessionStore.ts';
import { useI18n } from '../../i18n/index.ts';
import { useOnline } from '@mister-guiiug/dev-pwa-config/react/use-online';

export interface ActionGuardOptions {
  online?: boolean;
  operate?: boolean;
  admin?: boolean;
  /** Exige des données live (pas le cache hors-ligne). */
  writable?: boolean;
}

/** Code stable du motif de blocage (indépendant de la langue). */
export type GuardReasonCode = 'offline' | 'readonly' | 'operate' | 'admin';

export interface ActionGuardResult {
  allowed: boolean;
  /** Motif traduit, prêt à afficher (ou `null` si l'action est permise). */
  reason: string | null;
  /** Motif sous forme de code stable, pour tester le cas sans dépendre du texte. */
  reasonCode: GuardReasonCode | null;
  disabled: boolean;
  /** Props à étaler sur un bouton désactivable. */
  disabledProps: { disabled: boolean; 'aria-disabled'?: true };
  wrap: <T extends (...args: never[]) => unknown>(fn: T) => T;
}

export function useActionGuard(
  options: ActionGuardOptions = {}
): ActionGuardResult {
  const online = useOnline();
  const fromCache = useFleetStore(s => s.fromCache);
  const user = useSessionStore(s => s.user);
  const { t } = useI18n();

  return useMemo(() => {
    let reasonCode: GuardReasonCode | null = null;

    if (options.online && !online) reasonCode = 'offline';
    else if (options.writable && fromCache) reasonCode = 'readonly';
    else if (options.operate && !canOperate(user)) reasonCode = 'operate';
    else if (options.admin && !canAdmin(user)) reasonCode = 'admin';

    const reason =
      reasonCode === null
        ? null
        : reasonCode === 'offline'
          ? t('guard.offline')
          : reasonCode === 'readonly'
            ? t('guard.readonly')
            : reasonCode === 'operate'
              ? t('guard.operate')
              : t('guard.admin');

    const allowed = reasonCode === null;

    const wrap = <T extends (...args: never[]) => unknown>(fn: T): T =>
      ((...args: Parameters<T>) => {
        if (!allowed) return undefined;
        return fn(...args);
      }) as T;

    return {
      allowed,
      reason,
      reasonCode,
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
    t,
    options.online,
    options.writable,
    options.operate,
    options.admin,
  ]);
}
