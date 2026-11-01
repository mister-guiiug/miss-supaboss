import { Plug, TriangleAlert } from 'lucide-react';
import type { AccountDto } from '../../../shared/contracts.ts';
import { PROXY_BASE } from '../../api/index.ts';
import { classifyLastError } from '../../api/syncError.ts';
import { useI18n } from '../../i18n/index.ts';

/**
 * Bannière d'erreur de synchro actionnable : Retester / Vérifier le proxy,
 * avec distinction réseau · PAT · scopes.
 */
export function AccountSyncBanner({
  account,
  busy,
  onRetest,
}: {
  account: AccountDto;
  busy?: boolean;
  onRetest: () => void;
}) {
  const { t } = useI18n();
  if (!account.lastError) return null;

  const kind = classifyLastError(account.lastError);
  const kindLabel = t(`accounts.syncKind.${kind}`);

  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-[var(--sb-critical)]/30 bg-[var(--sb-critical)]/10 p-2.5 text-xs text-[var(--sb-critical)]"
    >
      <p className="flex items-start gap-1.5 font-medium">
        <TriangleAlert
          size={14}
          aria-hidden="true"
          className="mt-0.5 shrink-0"
        />
        <span>
          <span className="mr-1 rounded bg-[var(--sb-critical)]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            {kindLabel}
          </span>
          {account.lastError}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onRetest}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--sb-critical)]/40 px-2.5 py-1 font-medium disabled:opacity-50"
        >
          <Plug size={13} aria-hidden="true" /> {t('accounts.retest')}
        </button>
        {kind === 'network' && (
          <a
            href="https://github.com/mister-guiiug/miss-supaboss/blob/main/proxy/README.md"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg border border-[var(--sb-critical)]/40 px-2.5 py-1 font-medium underline-offset-2 hover:underline"
          >
            {t('accounts.verifyProxy')}
            {PROXY_BASE ? '' : ` (${t('accounts.proxyMissing')})`}
          </a>
        )}
        {kind === 'scope' && (
          <a
            href="https://supabase.com/docs/guides/platform/access-control"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg border border-[var(--sb-critical)]/40 px-2.5 py-1 font-medium underline-offset-2 hover:underline"
          >
            {t('accounts.scopesDoc')}
          </a>
        )}
        {kind === 'pat' && (
          <a
            href="https://supabase.com/dashboard/account/tokens"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg border border-[var(--sb-critical)]/40 px-2.5 py-1 font-medium underline-offset-2 hover:underline"
          >
            {t('accounts.patDoc')}
          </a>
        )}
      </div>
    </div>
  );
}
