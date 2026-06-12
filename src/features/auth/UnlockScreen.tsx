import { useState, type FormEvent } from 'react';
import { KeyRound, LockKeyhole, ShieldAlert } from 'lucide-react';
import { api } from '../../api/index.ts';
import { toast } from '../../store/useUiStore.ts';

/**
 * Coffre activé mais verrouillé (mode local-first, chiffrement opt-in) : on
 * exige la phrase secrète avant de déchiffrer les PAT et de charger la flotte.
 * Échappatoire « phrase oubliée » : réinitialise le coffre (efface les comptes
 * chiffrés, irrécupérables — les PAT se régénèrent côté Supabase).
 */
export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!api.vault || passphrase.length === 0) return;
    setBusy(true);
    setError(false);
    const ok = await api.vault.unlock(passphrase);
    setBusy(false);
    if (ok) {
      setPassphrase('');
      onUnlocked();
    } else {
      setError(true);
    }
  };

  const doReset = (): void => {
    api.vault?.reset();
    toast.success('Coffre réinitialisé.');
    window.location.reload();
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-5 px-4 text-center">
      <LockKeyhole size={44} aria-hidden="true" className="text-primary" />
      <div>
        <h1 className="text-xl font-bold">Coffre verrouillé</h1>
        <p className="mt-1 text-sm text-[var(--sb-text-soft)]">
          Saisissez votre phrase secrète pour déchiffrer les PAT stockés sur cet
          appareil.
        </p>
      </div>

      <form
        onSubmit={e => void submit(e)}
        className="card w-full space-y-3 p-5"
      >
        <input
          type="password"
          value={passphrase}
          onChange={e => {
            setPassphrase(e.target.value);
            setError(false);
          }}
          placeholder="Phrase secrète"
          autoComplete="current-password"
          aria-label="Phrase secrète"
          aria-invalid={error}
          className="w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm"
        />
        {error && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-[var(--sb-critical)]">
            <ShieldAlert size={14} aria-hidden="true" /> Phrase incorrecte.
          </p>
        )}
        <button
          type="submit"
          disabled={busy || passphrase.length === 0}
          className="touch-target flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-[#06281a] disabled:opacity-50"
        >
          <KeyRound size={18} aria-hidden="true" />
          {busy ? 'Déverrouillage…' : 'Déverrouiller'}
        </button>
      </form>

      {confirmReset ? (
        <div className="card w-full space-y-2 p-4 text-left">
          <p className="flex items-start gap-1.5 text-xs text-[var(--sb-warn)]">
            <ShieldAlert
              size={14}
              aria-hidden="true"
              className="mt-0.5 shrink-0"
            />
            Réinitialiser efface définitivement les comptes chiffrés de cet
            appareil. Les PAT restent régénérables sur Supabase.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="touch-target flex-1 rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={doReset}
              className="touch-target flex-1 rounded-xl border border-[var(--sb-critical)] px-3 text-sm font-semibold text-[var(--sb-critical)]"
            >
              Réinitialiser
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="text-xs text-[var(--sb-text-soft)] underline"
        >
          Phrase oubliée ?
        </button>
      )}
    </div>
  );
}
