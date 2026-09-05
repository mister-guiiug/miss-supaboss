import { useState } from 'react';
import {
  accountCreateBodySchema,
  accountUpdateBodySchema,
  type AccountDto,
} from '../../../shared/contracts.ts';
import { api, ApiError } from '../../api/index.ts';
import { toast } from '../../store/useUiStore.ts';
import { ConfirmDialog } from '@mister-guiiug/dev-pwa-config/react/confirm-dialog';
import { useI18n } from '../../i18n/index.ts';

const COLORS = [
  '#3ecf8e',
  '#38bdf8',
  '#a78bfa',
  '#fb7185',
  '#fbbf24',
  '#f97316',
];

/**
 * Ajout OU modification d'un compte. À l'ajout, le PAT part au serveur en HTTPS
 * et n'en revient jamais. En modification (renommage), on ne touche qu'à l'alias
 * et la couleur — le PAT reste inchangé. Monté avec une `key` par cible côté
 * parent → les champs sont pré-remplis depuis `account`.
 */
export function AccountForm({
  open,
  account,
  onClose,
  onSaved,
}: {
  open: boolean;
  account: AccountDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const isEdit = account !== null;
  const [alias, setAlias] = useState(account?.alias ?? '');
  const [pat, setPat] = useState('');
  const [color, setColor] = useState(account?.color ?? COLORS[0] ?? '#3ecf8e');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setError(null);
    if (account) {
      const parsed = accountUpdateBodySchema.safeParse({ alias, color });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? t('accounts.form.invalid'));
        return;
      }
      setBusy(true);
      try {
        await api.updateAccount(account.id, parsed.data);
        toast.success(
          t('accounts.form.updated', { alias: parsed.data.alias ?? alias })
        );
        onSaved();
      } catch (e) {
        setError(
          e instanceof ApiError ? e.message : t('accounts.form.updateFail')
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    const parsed = accountCreateBodySchema.safeParse({ alias, pat, color });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('accounts.form.invalid'));
      return;
    }
    setBusy(true);
    try {
      await api.createAccount(parsed.data);
      toast.success(t('accounts.form.added', { alias: parsed.data.alias }));
      setAlias('');
      setPat('');
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('accounts.form.addFail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title={isEdit ? t('accounts.form.editTitle') : t('accounts.add')}
      confirmLabel={isEdit ? t('common.save') : t('accounts.form.testAndAdd')}
      loading={busy}
      onCancel={onClose}
      onConfirm={() => void submit()}
    >
      <div className="space-y-3 text-left">
        <label className="block">
          <span className="text-xs font-medium text-[var(--sb-text-soft)]">
            {t('accounts.form.aliasLabel')}
          </span>
          <input
            type="text"
            value={alias}
            onChange={e => setAlias(e.target.value)}
            placeholder={t('accounts.form.aliasPlaceholder')}
            className="mt-1 w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm"
          />
        </label>
        {!isEdit && (
          <label className="block">
            <span className="text-xs font-medium text-[var(--sb-text-soft)]">
              {t('accounts.form.patLabel')}
            </span>
            <input
              type="password"
              value={pat}
              onChange={e => setPat(e.target.value)}
              placeholder="sbp_xxxxxxxx…"
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 font-mono text-sm"
            />
            <span className="mt-1 block text-xs text-[var(--sb-text-soft)]">
              {t('accounts.form.patHint')}
            </span>
          </label>
        )}
        <div
          role="radiogroup"
          aria-label={t('accounts.form.colorAria')}
          className="flex gap-2"
        >
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={t('accounts.form.colorSwatchAria', { color: c })}
              onClick={() => setColor(c)}
              className={`size-8 rounded-full border-2 ${
                color === c ? 'border-[var(--sb-text)]' : 'border-transparent'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
        {error && <p className="text-sm text-[var(--sb-critical)]">{error}</p>}
      </div>
    </ConfirmDialog>
  );
}
