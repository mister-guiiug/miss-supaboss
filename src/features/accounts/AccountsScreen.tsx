import { useMemo, useState } from 'react';
import { Plug, Plus, Trash2 } from 'lucide-react';
import type { AccountDto } from '../../../shared/contracts.ts';
import {
  ACTIVE_PROJECT_LIMIT,
  activeProjects,
} from '../../../shared/guards.ts';
import { formatRelative } from '../../../shared/format.ts';
import { api, ApiError, IS_MOCK } from '../../api/index.ts';
import { projectsOfAccount, useFleetStore } from '../../store/useFleetStore.ts';
import { canAdmin, useSessionStore } from '../../store/useSessionStore.ts';
import { toast } from '../../store/useUiStore.ts';
import { ConfirmSheet } from '../../shared/components/ConfirmSheet.tsx';
import { EmptyState } from '../../shared/components/EmptyState.tsx';
import { AccountForm } from './AccountForm.tsx';

export function AccountsScreen() {
  const fleet = useFleetStore(s => s.fleet);
  const loadFleet = useFleetStore(s => s.loadFleet);
  const fromCache = useFleetStore(s => s.fromCache);
  const user = useSessionStore(s => s.user);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<AccountDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const accounts = useMemo(
    () => fleet?.accounts.map(a => a.account) ?? [],
    [fleet]
  );
  const admin = canAdmin(user) && !fromCache;

  const test = async (account: AccountDto): Promise<void> => {
    setBusyId(account.id);
    try {
      const res = await api.testAccount(account.id);
      toast.success(
        `${account.alias} : ${res.organizations} org, ${res.projects} projets ✔`
      );
      await loadFleet(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Test impossible');
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (account: AccountDto): Promise<void> => {
    setBusyId(account.id);
    try {
      await api.updateAccount(account.id, { enabled: !account.enabled });
      await loadFleet(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Mise à jour impossible');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (!toDelete) return;
    setBusyId(toDelete.id);
    try {
      await api.deleteAccount(toDelete.id);
      toast.success(`Compte « ${toDelete.alias} » supprimé`);
      setToDelete(null);
      await loadFleet(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Suppression impossible');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {admin && (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="touch-target flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-[#06281a]"
        >
          <Plus size={18} aria-hidden="true" /> Ajouter un compte Supabase
        </button>
      )}

      {accounts.length === 0 ? (
        <EmptyState emoji="🗂️" title="Aucun compte">
          Ajoutez votre premier compte Supabase avec un PAT (Personal Access
          Token).
        </EmptyState>
      ) : (
        accounts.map(account => {
          const projects = projectsOfAccount(fleet, account.id);
          const actives = activeProjects(projects);
          return (
            <section key={account.id} className="card space-y-3 p-4">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ background: account.color }}
                />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold">{account.alias}</h2>
                  <p className="truncate text-xs text-[var(--sb-text-soft)]">
                    PAT {account.patHint} · synchro{' '}
                    {formatRelative(account.lastSyncAt)}
                  </p>
                </div>
                <span className="tnum rounded-full bg-[var(--sb-surface-2)] px-2.5 py-1 text-sm font-bold">
                  {actives.length}/{ACTIVE_PROJECT_LIMIT}
                </span>
              </div>
              {account.lastError && (
                <p className="rounded-lg bg-[var(--sb-critical)]/10 p-2 text-xs text-[var(--sb-critical)]">
                  {account.lastError}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  type="button"
                  disabled={busyId === account.id || fromCache}
                  onClick={() => void test(account)}
                  className="touch-target flex items-center gap-1.5 rounded-xl border border-[var(--sb-border)] px-3 font-medium disabled:opacity-50"
                >
                  <Plug size={15} aria-hidden="true" />
                  {busyId === account.id ? 'Test…' : 'Tester'}
                </button>
                {admin && (
                  <>
                    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--sb-border)] px-3 py-2.5 font-medium">
                      <input
                        type="checkbox"
                        checked={account.enabled}
                        disabled={busyId === account.id}
                        onChange={() => void toggle(account)}
                      />
                      Actif dans l'app
                    </label>
                    <button
                      type="button"
                      aria-label={`Supprimer ${account.alias}`}
                      disabled={busyId === account.id}
                      onClick={() => setToDelete(account)}
                      className="touch-target ml-auto flex items-center justify-center rounded-xl border border-[var(--sb-critical)]/40 px-3 text-[var(--sb-critical)] disabled:opacity-50"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            </section>
          );
        })
      )}

      {IS_MOCK && (
        <p className="text-center text-xs text-[var(--sb-text-soft)]">
          Mode démo : comptes simulés, aucun vrai PAT.
        </p>
      )}

      <AccountForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void loadFleet(true);
        }}
      />

      <ConfirmSheet
        open={toDelete !== null}
        title={`Supprimer « ${toDelete?.alias ?? ''} » ?`}
        confirmLabel="Supprimer"
        danger
        busy={busyId === toDelete?.id}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void remove()}
      >
        <p>
          Le PAT chiffré, les tags et l'historique de méta de ce compte seront
          supprimés de Miss Supaboss. Les projets Supabase eux-mêmes ne sont PAS
          touchés.
        </p>
      </ConfirmSheet>
    </div>
  );
}
