import { useState } from 'react';
import {
  accountCreateBodySchema,
  accountUpdateBodySchema,
  type AccountDto,
} from '../../../shared/contracts.ts';
import {
  api,
  ApiError,
  IS_MOCK,
  PROXY_BASE,
  REAL_AVAILABLE,
  switchDemoMode,
} from '../../api/index.ts';
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
 *
 * Garde P0 : en mode démo, pas d'ajout de PAT « réel » (fixtures fictives).
 * Local-first : coffre obligatoire avant la première persistance du PAT.
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
  const [patExpiresAt, setPatExpiresAt] = useState(
    account?.patExpiresAt?.slice(0, 10) ?? ''
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsVault =
    !isEdit && Boolean(PROXY_BASE) && !(api.vault?.isEnabled() ?? false);
  const [vaultPass, setVaultPass] = useState('');
  const [vaultPass2, setVaultPass2] = useState('');

  const submit = async (): Promise<void> => {
    setError(null);

    // P0 UX : un PAT réel en mode démo invente API/Web/Staging — on bloque.
    if (!isEdit && IS_MOCK) {
      setError(
        REAL_AVAILABLE
          ? t('accounts.form.demoBlocked')
          : t('accounts.form.demoForced')
      );
      return;
    }

    if (account) {
      const parsed = accountUpdateBodySchema.safeParse({
        alias,
        color,
        patExpiresAt: patExpiresAt || null,
      });
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

    if (needsVault) {
      if (vaultPass.length < 8) {
        setError(t('settings.vaultMin'));
        return;
      }
      if (vaultPass !== vaultPass2) {
        setError(t('settings.vaultMismatch'));
        return;
      }
    }

    const parsed = accountCreateBodySchema.safeParse({
      alias,
      pat,
      color,
      patExpiresAt: patExpiresAt || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('accounts.form.invalid'));
      return;
    }
    setBusy(true);
    try {
      if (needsVault && api.vault) {
        await api.vault.enable(vaultPass);
      }
      await api.createAccount(parsed.data);
      toast.success(t('accounts.form.added', { alias: parsed.data.alias }));
      setAlias('');
      setPat('');
      setPatExpiresAt('');
      setVaultPass('');
      setVaultPass2('');
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
      confirmLabel={
        isEdit
          ? t('common.save')
          : IS_MOCK
            ? t('accounts.form.blockedInDemo')
            : t('accounts.form.testAndAdd')
      }
      loading={busy}
      onCancel={onClose}
      onConfirm={() => void submit()}
    >
      <div className="space-y-3 text-left">
        {!isEdit && IS_MOCK && (
          <div
            role="alert"
            className="space-y-2 rounded-xl border border-[var(--sb-warn)]/40 bg-[var(--sb-warn)]/10 p-3 text-xs text-[var(--sb-warn)]"
          >
            <p>{t('accounts.form.demoWarning')}</p>
            {REAL_AVAILABLE && (
              <button
                type="button"
                onClick={() => void switchDemoMode(false)}
                className="rounded-lg bg-[var(--sb-warn)] px-3 py-1.5 font-semibold text-[#1a1200]"
              >
                {t('accounts.form.switchToReal')}
              </button>
            )}
          </div>
        )}

        <label className="block">
          <span className="text-xs font-medium text-[var(--sb-text-soft)]">
            {t('accounts.form.aliasLabel')}
          </span>
          <input
            type="text"
            value={alias}
            onChange={e => setAlias(e.target.value)}
            placeholder={t('accounts.form.aliasPlaceholder')}
            disabled={!isEdit && IS_MOCK}
            className="mt-1 w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm disabled:opacity-50"
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
              disabled={IS_MOCK}
              className="mt-1 w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 font-mono text-sm disabled:opacity-50"
            />
            <span className="mt-1 block text-xs text-[var(--sb-text-soft)]">
              {t(
                PROXY_BASE
                  ? 'accounts.form.patHintLocal'
                  : 'accounts.form.patHint'
              )}
            </span>
            <span className="mt-1 block text-xs text-[var(--sb-text-soft)]">
              {t('accounts.form.patScopes')}
            </span>
          </label>
        )}

        <label className="block">
          <span className="text-xs font-medium text-[var(--sb-text-soft)]">
            {t('accounts.form.patExpiresLabel')}
          </span>
          <input
            type="date"
            value={patExpiresAt}
            onChange={e => setPatExpiresAt(e.target.value)}
            disabled={!isEdit && IS_MOCK}
            className="mt-1 w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm disabled:opacity-50"
          />
          <span className="mt-1 block text-xs text-[var(--sb-text-soft)]">
            {t('accounts.form.patExpiresHint')}
          </span>
        </label>

        {needsVault && !IS_MOCK && (
          <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs font-medium text-[var(--sb-text)]">
              {t('accounts.form.vaultRequired')}
            </p>
            <input
              type="password"
              value={vaultPass}
              onChange={e => setVaultPass(e.target.value)}
              placeholder={t('settings.vaultNewPlaceholder')}
              autoComplete="new-password"
              aria-label={t('settings.vaultNewAria')}
              className="w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm"
            />
            <input
              type="password"
              value={vaultPass2}
              onChange={e => setVaultPass2(e.target.value)}
              placeholder={t('settings.vaultConfirm')}
              autoComplete="new-password"
              aria-label={t('settings.vaultConfirm')}
              className="w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm"
            />
          </div>
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
              disabled={!isEdit && IS_MOCK}
              className={`size-8 rounded-full border-2 disabled:opacity-50 ${
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
