import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/index.ts';
import { useSessionStore } from '../../store/useSessionStore.ts';

export function LoginScreen() {
  const login = useSessionStore(s => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Identifiants invalides'
          : 'Connexion impossible (serveur joignable ?)'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-safe">
      <div className="text-center">
        <img
          src="favicon.svg"
          alt=""
          width={72}
          height={72}
          className="mx-auto rounded-2xl"
        />
        <h1 className="mt-3 text-2xl font-bold">Miss Supaboss</h1>
        <p className="text-sm text-[var(--sb-text-soft)]">
          Pilotage multi-comptes Supabase Free
        </p>
      </div>
      <form onSubmit={e => void submit(e)} className="card space-y-3 p-5">
        <label className="block">
          <span className="text-xs font-medium text-[var(--sb-text-soft)]">
            E-mail
          </span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-[var(--sb-text-soft)]">
            Mot de passe
          </span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-[var(--sb-critical)]">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="touch-target w-full rounded-xl bg-primary px-4 font-semibold text-[#06281a] disabled:opacity-60"
        >
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p className="text-center text-xs text-[var(--sb-text-soft)]">
        Compte initial : voir la console serveur au premier démarrage.
      </p>
    </main>
  );
}
