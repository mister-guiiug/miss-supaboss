import { useState, type ReactNode } from 'react';
import {
  Download,
  Flame,
  LogOut,
  Monitor,
  Moon,
  OctagonAlert,
  RotateCcw,
  Sun,
  TestTube2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
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
import { clearSnapshot } from '../../offline/lastKnown.ts';
import { REPO_URL } from '../../links.ts';

export function SettingsScreen() {
  const settings = useFleetStore(s => s.settings);
  const saveSettings = useFleetStore(s => s.saveSettings);
  const user = useSessionStore(s => s.user);
  const logout = useSessionStore(s => s.logout);
  const { theme, setTheme } = useTheme();
  const [draft, setDraft] = useState(settings);
  const [passphrase, setPassphrase] = useState('');
  const [importBlob, setImportBlob] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    const parsed = settingsSchema.safeParse(draft);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Valeurs invalides');
      return;
    }
    const t = parsed.data.thresholds;
    if (!(t.warn < t.high && t.high < t.critical)) {
      toast.error(
        'Les seuils doivent être croissants (warn < high < critical)'
      );
      return;
    }
    await saveSettings(parsed.data);
  };

  const doExport = async (): Promise<void> => {
    if (passphrase.length < 8) {
      toast.error('Passphrase : 8 caractères minimum');
      return;
    }
    setBusy(true);
    try {
      const { blob, count } = await api.exportAccounts(passphrase);
      await navigator.clipboard.writeText(blob);
      toast.success(
        `${count} compte(s) exporté(s) — blob copié au presse-papier`
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Export impossible');
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (): Promise<void> => {
    if (passphrase.length < 8 || importBlob.length === 0) {
      toast.error('Passphrase et blob requis');
      return;
    }
    setBusy(true);
    try {
      const { imported, total } = await api.importAccounts(
        passphrase,
        importBlob
      );
      toast.success(`${imported}/${total} compte(s) importé(s)`);
      setImportBlob('');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Import impossible');
    } finally {
      setBusy(false);
    }
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
      {/* Profil/compte : seulement en mode réel (auto-hébergé). La PWA locale
          n'a pas de compte — pas de ligne « Connecté : … ». */}
      {!IS_MOCK && (
        <section className="card space-y-2 p-4" aria-label="Profil">
          <p className="text-sm">
            Connecté : <strong>{user?.email}</strong>{' '}
            <span className="rounded-full bg-[var(--sb-surface-2)] px-2 py-0.5 text-xs font-medium">
              {user?.role}
            </span>
          </p>
          <button
            type="button"
            onClick={() => void logout()}
            className="touch-target flex items-center gap-2 rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium"
          >
            <LogOut size={16} aria-hidden="true" /> Se déconnecter
          </button>
        </section>
      )}

      <section className="card space-y-3 p-4" aria-label="Apparence">
        <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
          Apparence
        </h2>
        <div role="radiogroup" aria-label="Thème" className="flex gap-2">
          {(
            [
              { id: 'light', label: 'Clair', Icon: Sun },
              { id: 'dark', label: 'Sombre', Icon: Moon },
              { id: 'system', label: 'Système', Icon: Monitor },
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

      <section className="card space-y-3 p-4" aria-label="Mode démo">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
          <TestTube2 size={15} aria-hidden="true" /> Mode démo
        </h2>

        {/* Interrupteur à bascule : ON = données d'exemple, OFF = store local
            VIDE (tes propres données, sur l'appareil). La bascule recharge. */}
        <div className="flex items-center justify-between gap-3">
          <p
            id="demo-desc"
            className="min-w-0 text-xs text-[var(--sb-text-soft)]"
          >
            {REAL_AVAILABLE
              ? 'Données simulées pour découvrir l’application. Désactive pour te connecter à ton vrai Supabase (PAT) — le jeton reste sur cet appareil.'
              : 'Données d’exemple pour découvrir l’application. Désactive pour partir d’un espace vide — tout est stocké sur cet appareil.'}
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={demoOn}
            aria-label="Mode démo"
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
            <RotateCcw size={15} aria-hidden="true" /> Réinitialiser les données
            de démo
          </button>
        )}
      </section>

      <section className="card space-y-3 p-4" aria-label="Alertes et synchro">
        <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
          Seuils d'alerte quotas (%)
        </h2>
        {numberField(
          <>
            <TriangleAlert
              size={14}
              aria-hidden="true"
              className="text-[var(--sb-warn)]"
            />{' '}
            Avertissement (warn)
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
            Élevé (high)
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
            Critique
          </>,
          draft.thresholds.critical,
          v =>
            setDraft(d => ({
              ...d,
              thresholds: { ...d.thresholds, critical: v },
            }))
        )}
        {numberField('Polling (secondes)', draft.pollingSeconds, v =>
          setDraft(d => ({ ...d, pollingSeconds: v }))
        )}
        {numberField(
          'Fenêtre de restauration (jours)',
          draft.restoreWindowDays,
          v => setDraft(d => ({ ...d, restoreWindowDays: v }))
        )}
        <button
          type="button"
          onClick={() => void save()}
          className="touch-target w-full rounded-xl bg-primary px-4 font-semibold text-[#06281a]"
        >
          Enregistrer les réglages
        </button>
      </section>

      {canAdmin(user) && (
        <section className="card space-y-3 p-4" aria-label="Export / import">
          <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
            Export / import chiffré des comptes
          </h2>
          <p className="text-xs text-[var(--sb-text-soft)]">
            Blob AES-256-GCM dérivé d'une passphrase (scrypt) : portable vers
            une autre instance Miss Supaboss. Ne le stockez pas en clair.
          </p>
          <input
            type="password"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            placeholder="Passphrase (min. 8 caractères)"
            autoComplete="off"
            aria-label="Passphrase d'export"
            className="w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void doExport()}
              className="touch-target flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium disabled:opacity-50"
            >
              <Download size={16} aria-hidden="true" /> Exporter
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void doImport()}
              className="touch-target flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium disabled:opacity-50"
            >
              <Upload size={16} aria-hidden="true" /> Importer
            </button>
          </div>
          <textarea
            value={importBlob}
            onChange={e => setImportBlob(e.target.value)}
            placeholder="Coller ici un blob supaboss-export-v1:… pour importer"
            aria-label="Blob d'import"
            rows={3}
            className="w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 font-mono text-xs"
          />
        </section>
      )}

      <section className="card space-y-2 p-4" aria-label="Stockage local">
        <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
          Stockage local
        </h2>
        <p className="text-xs text-[var(--sb-text-soft)]">
          Ce navigateur ne conserve que le dernier état non sensible (statuts,
          quotas) pour la consultation hors ligne — jamais de PAT ni de session
          en clair.
        </p>
        <button
          type="button"
          onClick={() => {
            void clearSnapshot();
            toast.success('Cache hors-ligne vidé');
          }}
          className="touch-target rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium"
        >
          Vider le cache hors-ligne
        </button>
      </section>

      <section className="card p-4" aria-label="À propos">
        <p className="text-xs text-[var(--sb-text-soft)]">
          Miss Supaboss v{__APP_VERSION__}
        </p>
        <div className="mt-3">
          <FamilyApps currentAppId="miss-supaboss" repoUrl={REPO_URL} />
        </div>
      </section>
    </div>
  );
}
