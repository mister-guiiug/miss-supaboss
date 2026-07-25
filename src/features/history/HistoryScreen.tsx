import { Inbox, ScrollText } from 'lucide-react';
import type { OperationDto } from '../../../shared/contracts.ts';
import { formatDateTime } from '../../../shared/format.ts';
import { ListSkeleton } from '../../shared/components/Skeleton.tsx';
import { EmptyState } from '../../shared/components/EmptyState.tsx';
import { useOnline } from '../../shared/hooks/useOnline.ts';
import { useOperations } from '../../shared/hooks/useOperations.ts';
import { useI18n } from '../../i18n/index.ts';
import type { Messages } from '../../i18n/messages.ts';

/** Action serveur → clé de message (le catalogue ne peut pas avoir de point). */
const ACTION_KEYS: Record<
  OperationDto['action'],
  keyof Messages['history']['actions']
> = {
  login: 'login',
  'account.create': 'accountCreate',
  'account.update': 'accountUpdate',
  'account.delete': 'accountDelete',
  'account.test': 'accountTest',
  'project.pause': 'projectPause',
  'project.restore': 'projectRestore',
  'project.meta': 'projectMeta',
  'config.export': 'configExport',
  'config.import': 'configImport',
};

const STATUS_STYLE: Record<OperationDto['status'], string> = {
  ok: 'bg-[var(--sb-ok)]/15 text-[var(--sb-ok)]',
  error: 'bg-[var(--sb-critical)]/15 text-[var(--sb-critical)]',
  pending: 'bg-[var(--sb-warn)]/15 text-[var(--sb-warn)] sb-pulse',
};

/** Journal d'audit : qui a fait quoi, quand, sur quel projet, avec quel résultat. */
export function HistoryScreen() {
  const { t } = useI18n();
  const { data: operations, isLoading, isError } = useOperations(100);
  const online = useOnline();

  if (isError) {
    return (
      <EmptyState icon={Inbox} title={t('history.unavailableTitle')}>
        {online ? t('history.noServer') : t('history.needsConnection')}
      </EmptyState>
    );
  }
  if (isLoading || operations === undefined) return <ListSkeleton count={5} />;
  if (operations.length === 0) {
    return (
      <EmptyState icon={ScrollText} title={t('history.emptyTitle')}>
        {t('history.emptyBody')}
      </EmptyState>
    );
  }

  return (
    <ul className="space-y-2" aria-label={t('history.listAria')}>
      {operations.map(op => (
        <li key={op.id} className="card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold">
              {t(`history.actions.${ACTION_KEYS[op.action]}`)}
              {op.projectName ? ` — ${op.projectName}` : ''}
            </p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[op.status]}`}
            >
              {op.status === 'ok'
                ? t('history.status.ok')
                : op.status === 'error'
                  ? t('history.status.error')
                  : t('history.status.pending')}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--sb-text-soft)]">
            {formatDateTime(op.ts)} · {op.userEmail}
            {op.accountAlias ? ` · ${op.accountAlias}` : ''}
          </p>
          {op.detail && (
            <p className="mt-1 text-xs text-[var(--sb-text-soft)]">
              {op.detail}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
