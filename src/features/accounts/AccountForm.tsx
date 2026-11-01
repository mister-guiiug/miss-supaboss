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
import { storeVaultPassphrase } from '../../api/crypto/browserCredentials.ts';
import { isPassphraseAcceptable } from '../../api/crypto/passphraseStrength.ts';
import { PassphraseField } from '../../shared/components/PassphraseField.tsx';
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

type ScopePreset = 'read' | 'admin';

/**
 * Ajout OU modification d'un compte. À l'ajout, le PAT part au serveur en HTTPS
 * et n'en revient jamais. En modification (renommage), on ne touche qu'à l'alias
 * et la couleur — le PAT reste inchangé. Monté avec une `key` par cible côté
 * parent → les champs sont pré-remplis depuis `account`.
 *
 * Garde P0 : en mode démo, pas d'ajout de PAT « réel » (fixtures fictives).
 * Local-first : coffre recommandé (défaut coché), optionnel avec avertissement.
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
  /** Premier PAT local-first sans coffre déjà actif → on propose d'en créer un. */
  const canOfferVault =
    !isEdit && Boolean(PROXY_BASE) && !(api.vault?.isEnabled() ?? false);
  /** Défaut : coffre recommandé (coché). */
  const [enableVault, setEnableVault] = useState(true);
  const [vaultPass, setVaultPass] = useState('');
  const [vaultPass2, setVaultPass2] = useState('');
  const [scopePreset, setScopePreset] = useState<ScopePreset>('admin');

  const submit = async (): Promise<void> => {
    setError(null);

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

    if (canOfferVault && enableVault) {
      if (!isPassphraseAcceptable(vaultPass)) {
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
      if (canOfferVault && enableVault && api.vault) {
        await api.vault.enable(vaultPass);
        // Piste A : phrase proposée au gestionnaire du navigateur (défaut).
        await storeVaultPassphrase(vaultPass);
      }
      // createAccount sonde déjà GET /organizations (PAT + scopes lecture).
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
            <fieldset className="mt-2 space-y-1.5">
              <legend className="text-xs font-medium text-[var(--sb-text-soft)]">
                {t('accounts.form.scopePresetLegend')}
              </legend>
              <div className="flex gap-2">
                {(
                  [
                    ['read', 'accounts.form.scopeRead'],
                    ['admin', 'accounts.form.scopeAdmin'],
                  ] as const
                ).map(([id, labelKey]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={scopePreset === id}
                    onClick={() => setScopePreset(id)}
                    disabled={IS_MOCK}
                    className={`flex-1 rounded-xl border px-2 py-2 text-xs font-medium disabled:opacity-50 ${
                      scopePreset === id
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--sb-text-soft)]">
                {t(
                  scopePreset === 'read'
                    ? 'accounts.form.scopeReadHint'
                    : 'accounts.form.scopeAdminHint'
                )}
              </p>
            </fieldset>
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

        {canOfferVault && !IS_MOCK && (
          <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <label className="flex items-start gap-2 text-xs font-medium text-[var(--sb-text)]">
              <input
                type="checkbox"
                checked={enableVault}
                onChange={e => setEnableVault(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 rounded border-[var(--sb-border)]"
              />
              <span>{t('accounts.form.vaultEnable')}</span>
            </label>
            {enableVault ? (
              <>
                <p className="text-xs text-[var(--sb-text-soft)]">
                  {t('accounts.form.vaultRecommended')}
                </p>
                <p className="text-xs text-[var(--sb-text-soft)]">
                  {t('accounts.form.vaultBrowserStore')}
                </p>
                {/* Login fixe pour le gestionnaire de mots de passe (piste A). */}
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value="miss-supaboss-vault"
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  className="sr-only"
                />
                <PassphraseField
                  value={vaultPass}
                  onChange={setVaultPass}
                  placeholder={t('settings.vaultNewPlaceholder')}
                  ariaLabel={t('settings.vaultNewAria')}
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
              </>
            ) : (
              <p
                role="status"
                className="rounded-lg border border-[var(--sb-warn)]/40 bg-[var(--sb-warn)]/10 px-2 py-1.5 text-xs text-[var(--sb-warn)]"
              >
                {t('accounts.form.vaultSkipped')}
              </p>
            )}
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
