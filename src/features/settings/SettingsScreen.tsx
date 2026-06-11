import { useState } from 'react';
import {
  Coffee,
  Download,
  LogOut,
  RotateCcw,
  TestTube2,
  Upload,
} from 'lucide-react';
import { useTheme, FamilyApps } from '@mister-guiiug/dev-wpa-config/react';
import { settingsSchema } from '../../../shared/contracts.ts';
import {
  api,
  ApiError,
  FORCED_MOCK,
  IS_MOCK,
  resetDemoData,
  switchDemoMode,
} from '../../api/index.ts';
import { useFleetStore } from '../../store/useFleetStore.ts';
import { canAdmin, useSessionStore } from '../../store/useSessionStore.ts';
import { toast } from '../../store/useUiStore.ts';
import { clearSnapshot } from '../../offline/lastKnown.ts';
import { REPO_URL, SPONSOR_URL } from '../../links.ts';

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

  // Bascule centralisée (drapeau + purge snapshot + reload) : demoMode.ts.
  const toggleDemo = (on: boolean): void => {
    void switchDemoMode(on);
  };

  const resetDemo = async (): Promise<void> => {
    resetDemoData();
    await clearSnapshot();
    window.location.reload();
  };

  const numberField = (
    label: string,
    value: number,
    onChange: (v: number) => void
  ) => (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
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
      <section className="card space-y-2 p-4" aria-label="Profil">
        <p className="text-sm">
          Connecté : <strong>{user?.email}</strong>{' '}
          <span className="rounded-full bg-[var(--sb-surface-2)] px-2 py-0.5 text-xs font-medium">
            {user?.role}
          </span>
        </p>
        {!IS_MOCK && (
          <button
            type="button"
            onClick={() => void logout()}
            className="touch-target flex items-center gap-2 rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium"
          >
            <LogOut size={16} aria-hidden="true" /> Se déconnecter
          </button>
        )}
      </section>

      <section className="card space-y-3 p-4" aria-label="Apparence">
        <h2 className="text-sm font-semibold text-[var(--sb-text-soft)]">
          Apparence
        </h2>
        <div role="radiogroup" aria-label="Thème" className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map(t => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              onClick={() => setTheme(t)}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium ${
                theme === t
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-[var(--sb-border)]'
              }`}
            >
              {t === 'light'
                ? '☀️ Clair'
                : t === 'dark'
                  ? '🌙 Sombre'
                  : '🖥️ Système'}
            </button>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-4" aria-label="Mode démo">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
          <TestTube2 size={15} aria-hidden="true" /> Mode démo
        </h2>

        {/* Interrupteur à bascule activer/désactiver (forcé ON, verrouillé en
            build Pages). La bascule recharge l'app sur une démo neuve. */}
        <div className="flex items-center justify-between gap-3">
          <p
            id="demo-desc"
            className="min-w-0 text-xs text-[var(--sb-text-soft)]"
          >
            {IS_MOCK
              ? 'Données fictives — aucune action ne touche vos comptes Supabase.'
              : 'Bascule sur des données fictives pour présenter l’outil sans toucher aux vrais projets. L’app se recharge.'}
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={IS_MOCK}
            aria-label="Mode démo"
            aria-describedby="demo-desc"
            disabled={FORCED_MOCK}
            onClick={() => toggleDemo(!IS_MOCK)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              IS_MOCK ? 'bg-primary' : 'bg-[var(--sb-surface-2)]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                IS_MOCK ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {FORCED_MOCK && (
          <p className="text-xs text-[var(--sb-text-soft)]">
            Ce build <strong>est</strong> la démo publique (GitHub Pages) : mode
            démo non débrayable (aucun backend). La bascule vers le mode réel se
            fait sur une instance auto-hébergée (cf. README).
          </p>
        )}

        {IS_MOCK && (
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
        {numberField('⚠ Avertissement (warn)', draft.thresholds.warn, v =>
          setDraft(d => ({ ...d, thresholds: { ...d.thresholds, warn: v } }))
        )}
        {numberField('🔶 Élevé (high)', draft.thresholds.high, v =>
          setDraft(d => ({ ...d, thresholds: { ...d.thresholds, high: v } }))
        )}
        {numberField('🔴 Critique', draft.thresholds.critical, v =>
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
          Miss Supaboss v{__APP_VERSION__} —{' '}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary"
          >
            Code source
          </a>{' '}
          ·{' '}
          <a
            href={SPONSOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary"
          >
            <Coffee size={13} aria-hidden="true" /> M'offrir un café
          </a>
        </p>
        <div className="mt-3">
          <FamilyApps currentAppId="miss-supaboss" repoUrl={REPO_URL} />
        </div>
      </section>
    </div>
  );
}
