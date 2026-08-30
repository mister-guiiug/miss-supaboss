import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  Download,
  Flame,
  History,
  LockKeyhole,
  LogOut,
  Monitor,
  Moon,
  OctagonAlert,
  RotateCcw,
  ShieldCheck,
  Sun,
  TestTube2,
  TriangleAlert,
  Unlock,
  Upload,
} from 'lucide-react';
import { Languages } from 'lucide-react';
import { useTheme, FamilyApps } from '@mister-guiiug/dev-wpa-config/react';
import { settingsSchema } from '../../../shared/contracts.ts';
import {
  api,
  ApiError,
  IS_MOCK,
  REAL_AVAILABLE,
  isDemoSeed,
  resetDemoData,
  setDemoSeed,
  switchDemoMode,
} from '../../api/index.ts';
import { useFleetStore } from '../../store/useFleetStore.ts';
import { canAdmin, useSessionStore } from '../../store/useSessionStore.ts';
import { toast } from '../../store/useUiStore.ts';
import { ConfirmDialog } from '@mister-guiiug/dev-wpa-config/react/confirm-dialog';
import { repoUrl } from '@mister-guiiug/dev-wpa-config/apps-catalog';
import { clearSnapshot } from '../../offline/lastKnown.ts';
import { APP_ID } from '../../appId.ts';
import { useI18n } from '../../i18n/index.ts';

export function SettingsScreen() {
  const { t, locale, setLocale, locales } = useI18n();
  const settings = useFleetStore(s => s.settings);
  const saveSettings = useFleetStore(s => s.saveSettings);
  const user = useSessionStore(s => s.user);
  const logout = useSessionStore(s => s.logout);
  const { theme, setTheme } = useTheme();
  const [draft, setDraft] = useState(settings);
  const [passphrase, setPassphrase] = useState('');
  const [importBlob, setImportBlob] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [vaultEnabled, setVaultEnabled] = useState(
    () => api.vault?.isEnabled() ?? false
  );
  const [vaultPass, setVaultPass] = useState('');
  const [vaultPass2, setVaultPass2] = useState('');

  const save = async (): Promise<void> => {
    const parsed = settingsSchema.safeParse(draft);
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? t('settings.invalidValues')
      );
      return;
    }
    const th = parsed.data.thresholds;
    if (!(th.warn < th.high && th.high < th.critical)) {
      toast.error(t('settings.thresholdsOrder'));
      return;
    }
    await saveSettings(parsed.data);
  };

  const doExport = async (): Promise<void> => {
    if (passphrase.length < 8) {
      toast.error(t('settings.passphraseMin'));
      return;
    }
    setBusy(true);
    try {
      const { blob, count } = await api.exportAccounts(passphrase);
      await navigator.clipboard.writeText(blob);
      toast.success(t('settings.exportOk', { count }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('settings.exportFail'));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (): Promise<void> => {
    if (passphrase.length < 8 || importBlob.length === 0) {
      toast.error(t('settings.passphraseBlobRequired'));
      return;
    }
    setBusy(true);
    try {
      const { imported, total } = await api.importAccounts(
        passphrase,
        importBlob
      );
      toast.success(t('settings.importOk', { imported, total }));
      setImportBlob('');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('settings.importFail'));
    } finally {
      setBusy(false);
    }
  };

  const enableVault = async (): Promise<void> => {
    const vault = api.vault;
    if (!vault) return;
    if (vaultPass.length < 8) {
      toast.error(t('settings.vaultMin'));
      return;
    }
    if (vaultPass !== vaultPass2) {
      toast.error(t('settings.vaultMismatch'));
      return;
    }
    setBusy(true);
    try {
      await vault.enable(vaultPass);
      setVaultEnabled(true);
      setVaultPass('');
      setVaultPass2('');
      toast.success(t('settings.vaultEnabled'));
    } catch {
      toast.error(t('settings.vaultEnableFail'));
    } finally {
      setBusy(false);
    }
  };

  const disableVault = async (): Promise<void> => {
    const vault = api.vault;
    if (!vault) return;
    setBusy(true);
    try {
      await vault.disable();
      setVaultEnabled(false);
      toast.success(t('settings.vaultDisabled'));
    } catch {
      toast.error(t('settings.vaultDisableFail'));
    } finally {
      setBusy(false);
    }
  };

  const lockVault = (): void => {
    api.vault?.lock();
    window.location.reload();
  };

  // Quand le RÉEL est atteignable (backend, ou PWA + proxy Supabase),
  // l'interrupteur bascule démo (mock) ↔ réel. Sinon (PWA sans proxy), il
  // pilote juste les DONNÉES D'EXEMPLE (ON = démo, OFF = store local vide).
  const demoOn = REAL_AVAILABLE ? IS_MOCK : isDemoSeed();
  const onToggleDemo = (): void => {
    if (REAL_AVAILABLE) void switchDemoMode(!demoOn);
    else void setDemoSeed(!demoOn);
  };

  const resetDemo = async (): Promise<void> => {
    resetDemoData();
    await clearSnapshot();
    window.location.reload();
  };

  const numberField = (
    label: ReactNode,
    value: number,
    onChange: (v: number) => void
  ) => (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5">{label}</span>
      <input
        type="number"
        value={value}
        min={1}
        max={3600}
        onChange={e => onChange(Number(e.target.value))}
        className="tnum w-24 rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2 text-right"
      />
    </label>
  );

  return (
    <div className="space-y-4">
      {/* Historique des opérations — relogé ici depuis le bottom nav (consultatif,
          non quotidien) ; la route /history est inchangée. */}
      <Link to="/history" className="card flex items-center gap-3 p-4">
        <History
          size={18}
          aria-hidden="true"
          className="text-[var(--sb-text-soft)]"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t('settings.historyTitle')}</p>
          <p className="text-xs text-[var(--sb-text-soft)]">
            {t('settings.historySubtitle')}
          </p>
        </div>
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="text-[var(--sb-text-soft)]"
        />
      </Link>

      <section
        className="card space-y-3 p-4"
        aria-label={t('settings.appearance')}
      >
        <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
          {t('settings.appearance')}
        </h2>
        <div
          role="radiogroup"
          aria-label={t('settings.themeAria')}
          className="flex gap-2"
        >
          {(
            [
              { id: 'light', label: t('settings.theme.light'), Icon: Sun },
              { id: 'dark', label: t('settings.theme.dark'), Icon: Moon },
              {
                id: 'system',
                label: t('settings.theme.system'),
                Icon: Monitor,
              },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              onClick={() => setTheme(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium ${
                theme === id
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-[var(--sb-border)]'
              }`}
            >
              <Icon size={16} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </section>

      <section
        className="card space-y-3 p-4"
        aria-label={t('settings.language')}
      >
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
          <Languages size={15} aria-hidden="true" /> {t('settings.language')}
        </h2>
        <div
          role="radiogroup"
          aria-label={t('settings.languageAria')}
          className="flex gap-2"
        >
          {locales.map(loc => (
            <button
              key={loc}
              type="button"
              role="radio"
              aria-checked={locale === loc}
              onClick={() => setLocale(loc)}
              className={`flex flex-1 items-center justify-center rounded-xl border px-3 py-2.5 text-sm font-medium ${
                locale === loc
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-[var(--sb-border)]'
              }`}
            >
              {t(`languages.${loc}`)}
            </button>
          ))}
        </div>
      </section>

      <section
        className="card space-y-3 p-4"
        aria-label={t('settings.demoTitle')}
      >
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
          <TestTube2 size={15} aria-hidden="true" /> {t('settings.demoTitle')}
        </h2>

        {/* Interrupteur à bascule : ON = données d'exemple, OFF = store local
            VIDE (tes propres données, sur l'appareil). La bascule recharge. */}
        <div className="flex items-center justify-between gap-3">
          <p
            id="demo-desc"
            className="min-w-0 text-xs text-[var(--sb-text-soft)]"
          >
            {REAL_AVAILABLE
              ? t('settings.demoDescReal')
              : t('settings.demoDescLocal')}
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={demoOn}
            aria-label={t('settings.demoTitle')}
            aria-describedby="demo-desc"
            onClick={onToggleDemo}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
              demoOn ? 'bg-primary' : 'bg-[var(--sb-surface-2)]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                demoOn ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {demoOn && (
          <button
            type="button"
            onClick={() => void resetDemo()}
            className="touch-target flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--sb-border)] px-4 text-sm font-medium"
          >
            <RotateCcw size={15} aria-hidden="true" /> {t('settings.resetDemo')}
          </button>
        )}
      </section>

      <section
        className="card space-y-3 p-4"
        aria-label={t('settings.alertsAria')}
      >
        <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
          {t('settings.alertsTitle')}
        </h2>
        {numberField(
          <>
            <TriangleAlert
              size={14}
              aria-hidden="true"
              className="text-[var(--sb-warn)]"
            />{' '}
            {t('settings.thresholdWarn')}
          </>,
          draft.thresholds.warn,
          v =>
            setDraft(d => ({ ...d, thresholds: { ...d.thresholds, warn: v } }))
        )}
        {numberField(
          <>
            <Flame
              size={14}
              aria-hidden="true"
              className="text-[var(--sb-high)]"
            />{' '}
            {t('settings.thresholdHigh')}
          </>,
          draft.thresholds.high,
          v =>
            setDraft(d => ({ ...d, thresholds: { ...d.thresholds, high: v } }))
        )}
        {numberField(
          <>
            <OctagonAlert
              size={14}
              aria-hidden="true"
              className="text-[var(--sb-critical)]"
            />{' '}
            {t('settings.thresholdCritical')}
          </>,
          draft.thresholds.critical,
          v =>
            setDraft(d => ({
              ...d,
              thresholds: { ...d.thresholds, critical: v },
            }))
        )}
        {numberField(t('settings.polling'), draft.pollingSeconds, v =>
          setDraft(d => ({ ...d, pollingSeconds: v }))
        )}
        {numberField(t('settings.restoreWindow'), draft.restoreWindowDays, v =>
          setDraft(d => ({ ...d, restoreWindowDays: v }))
        )}
        <button
          type="button"
          onClick={() => void save()}
          className="touch-target w-full rounded-xl bg-primary px-4 font-semibold text-[#06281a]"
        >
          {t('settings.saveSettings')}
        </button>
      </section>

      {api.vault && canAdmin(user) && (
        <section
          className="card space-y-3 p-4"
          aria-label={t('settings.vaultAria')}
        >
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
            <LockKeyhole size={15} aria-hidden="true" />{' '}
            {t('settings.vaultHeading')}
          </h2>
          {vaultEnabled ? (
            <>
              <p className="flex items-start gap-1.5 text-xs text-[var(--sb-text-soft)]">
                <ShieldCheck
                  size={14}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-primary"
                />
                {t('settings.vaultActiveInfo')}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={lockVault}
                  className="touch-target flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium"
                >
                  <Unlock size={16} aria-hidden="true" /> {t('settings.lock')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disableVault()}
                  className="touch-target flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--sb-critical)] px-3 text-sm font-semibold text-[var(--sb-critical)] disabled:opacity-50"
                >
                  {t('settings.disable')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--sb-text-soft)]">
                {t('settings.vaultDisabledInfo')}
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
              <button
                type="button"
                disabled={busy}
                onClick={() => void enableVault()}
                className="touch-target flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-[#06281a] disabled:opacity-50"
              >
                <LockKeyhole size={16} aria-hidden="true" />{' '}
                {t('settings.enableEncryption')}
              </button>
            </>
          )}
        </section>
      )}

      {canAdmin(user) && (
        <section
          className="card space-y-3 p-4"
          aria-label={t('settings.exportAria')}
        >
          <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
            {t('settings.exportHeading')}
          </h2>
          <p className="text-xs text-[var(--sb-text-soft)]">
            {t('settings.exportInfo')}
          </p>
          <input
            type="password"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            placeholder={t('settings.exportPassphrasePlaceholder')}
            autoComplete="off"
            aria-label={t('settings.exportPassphraseAria')}
            className="w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void doExport()}
              className="touch-target flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium disabled:opacity-50"
            >
              <Download size={16} aria-hidden="true" /> {t('settings.export')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void doImport()}
              className="touch-target flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium disabled:opacity-50"
            >
              <Upload size={16} aria-hidden="true" /> {t('settings.import')}
            </button>
          </div>
          <textarea
            value={importBlob}
            onChange={e => setImportBlob(e.target.value)}
            placeholder={t('settings.importPlaceholder')}
            aria-label={t('settings.importAria')}
            rows={3}
            className="w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 font-mono text-xs"
          />
        </section>
      )}

      <section
        className="card space-y-2 p-4"
        aria-label={t('settings.storageAria')}
      >
        <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
          {t('settings.storageHeading')}
        </h2>
        <p className="text-xs text-[var(--sb-text-soft)]">
          {t('settings.storageInfo')}
        </p>
        <button
          type="button"
          onClick={() => {
            void clearSnapshot();
            toast.success(t('settings.cacheCleared'));
          }}
          className="touch-target rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium"
        >
          {t('settings.clearCache')}
        </button>
      </section>

      {/* Session : identité + déconnexion. Descendue du haut vers le bas (action
          rare et sensible). Mode réel uniquement (la PWA locale n'a pas de session). */}
      {!IS_MOCK && (
        <section
          className="card space-y-3 p-4"
          aria-label={t('settings.session')}
        >
          <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
            {t('settings.session')}
          </h2>
          <p className="text-sm">
            {t('settings.connectedAs')} <strong>{user?.email}</strong>{' '}
            <span className="rounded-full bg-[var(--sb-surface-2)] px-2 py-0.5 text-xs font-medium">
              {user?.role}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            className="touch-target flex items-center gap-2 rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium"
          >
            <LogOut size={16} aria-hidden="true" /> {t('settings.logout')}
          </button>
        </section>
      )}

      <section className="card p-4" aria-label={t('settings.aboutAria')}>
        <p className="text-xs text-[var(--sb-text-soft)]">
          {t('settings.version', { version: __APP_VERSION__ })}
        </p>
        <div className="mt-3">
          <FamilyApps currentAppId={APP_ID} repoUrl={repoUrl(APP_ID)} />
        </div>
      </section>

      <ConfirmDialog
        open={confirmLogout}
        title={t('settings.logoutTitle')}
        confirmLabel={t('settings.logout')}
        destructive
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => void logout()}
      >
        <p>{t('settings.logoutBody')}</p>
      </ConfirmDialog>
    </div>
  );
}
