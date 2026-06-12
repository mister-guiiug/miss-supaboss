import { useEffect, useState } from 'react';
import { Inbox, ScrollText } from 'lucide-react';
import type { OperationDto } from '../../../shared/contracts.ts';
import { api } from '../../api/index.ts';
import { formatDateTime } from '../../../shared/format.ts';
import { ListSkeleton } from '../../shared/components/Skeleton.tsx';
import { EmptyState } from '../../shared/components/EmptyState.tsx';
import { useOnline } from '../../shared/hooks/useOnline.ts';

const ACTION_LABELS: Record<OperationDto['action'], string> = {
  login: 'Connexion',
  'account.create': 'Compte ajouté',
  'account.update': 'Compte modifié',
  'account.delete': 'Compte supprimé',
  'account.test': 'Test de connectivité',
  'project.pause': 'Mise en pause',
  'project.restore': 'Restauration',
  'project.meta': 'Tags / favoris',
  'config.export': 'Export configuration',
  'config.import': 'Import configuration',
};

const STATUS_STYLE: Record<OperationDto['status'], string> = {
  ok: 'bg-[var(--sb-ok)]/15 text-[var(--sb-ok)]',
  error: 'bg-[var(--sb-critical)]/15 text-[var(--sb-critical)]',
  pending: 'bg-[var(--sb-warn)]/15 text-[var(--sb-warn)] sb-pulse',
};

/** Journal d'audit : qui a fait quoi, quand, sur quel projet, avec quel résultat. */
export function HistoryScreen() {
  const [operations, setOperations] = useState<OperationDto[] | null>(null);
  const [error, setError] = useState(false);
  const online = useOnline();

  useEffect(() => {
    let cancelled = false;
    void api
      .listOperations(100)
      .then(ops => {
        if (!cancelled) setOperations(ops);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <EmptyState icon={Inbox} title="Historique indisponible">
        {online
          ? 'Le serveur n’a pas répondu.'
          : 'L’historique nécessite une connexion.'}
      </EmptyState>
    );
  }
  if (operations === null) return <ListSkeleton count={5} />;
  if (operations.length === 0) {
    return (
      <EmptyState icon={ScrollText} title="Aucune action pour l'instant">
        Les pauses, restaurations et changements de comptes apparaîtront ici.
      </EmptyState>
    );
  }

  return (
    <ul className="space-y-2" aria-label="Historique des actions">
      {operations.map(op => (
        <li key={op.id} className="card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold">
              {ACTION_LABELS[op.action]}
              {op.projectName ? ` — ${op.projectName}` : ''}
            </p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[op.status]}`}
            >
              {op.status === 'ok'
                ? 'OK'
                : op.status === 'error'
                  ? 'Échec'
                  : 'En cours'}
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
