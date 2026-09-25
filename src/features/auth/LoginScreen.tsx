import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { MfaChallenge } from '@mister-guiiug/dev-pwa-config/react/mfa-challenge';
import type { LoginTotpBody } from '../../../shared/contracts.ts';
import { ApiError, switchDemoMode } from '../../api/index.ts';
import { useSessionStore } from '../../store/useSessionStore.ts';
import { useI18n } from '../../i18n/index.ts';

export function LoginScreen() {
  const { t } = useI18n();
  const login = useSessionStore(s => s.login);
  const totpPending = useSessionStore(s => s.totpPending);
  const verifySecondFactor = useSessionStore(s => s.verifySecondFactor);
  const cancelSecondFactor = useSessionStore(s => s.cancelSecondFactor);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const challengeRef = useRef<HTMLDivElement>(null);

  // Arrivée sur la seconde étape : le focus va au champ du code, sans quoi
  // un lecteur d'écran resterait sur un bouton qui n'existe plus.
  useEffect(() => {
    if (totpPending) challengeRef.current?.querySelector('input')?.focus();
  }, [totpPending]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? t('login.invalidCreds')
          : t('login.connectFail')
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async (factor: LoginTotpBody): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await verifySecondFactor(factor);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp-expired') {
        // Le store est revenu au mot de passe : le message l'y accompagne.
        setPassword('');
        setError(t('login.totpExpired'));
      } else if (err instanceof ApiError && err.status === 429) {
        setError(t('login.tooManyAttempts'));
      } else if (err instanceof ApiError && err.status === 401) {
        setError(t('login.totpInvalid'));
      } else {
        setError(t('login.connectFail'));
      }
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="text-center">
      <img
        src="favicon.svg"
        alt=""
        width={72}
        height={72}
        className="mx-auto rounded-2xl"
      />
      <h1 className="mt-3 text-2xl font-bold">{t('common.appName')}</h1>
      <p className="text-sm text-[var(--sb-text-soft)]">
        {t('login.subtitle')}
      </p>
    </div>
  );

  if (totpPending) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-safe">
        {header}
        {/* Le composant du socle : code à 6 chiffres (`one-time-code`,
            clavier numérique) OU code de secours, erreur en `role="alert"`. */}
        <div ref={challengeRef} className="card p-5">
          <MfaChallenge
            title={t('login.totpTitle')}
            titleAs="h2"
            onVerify={code => void verify({ code })}
            onRecover={code => void verify({ recoveryCode: code })}
            busy={busy}
            error={error}
            recoveryMinLength={10}
            className="space-y-3"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            cancelSecondFactor();
          }}
          className="touch-target flex items-center justify-center gap-2 rounded-xl border border-[var(--sb-border)] px-4 text-sm font-medium"
        >
          <ArrowLeft size={16} aria-hidden="true" /> {t('login.totpBack')}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-safe">
      {header}
      <form onSubmit={e => void submit(e)} className="card space-y-3 p-5">
        <label className="block">
          <span className="text-xs font-medium text-[var(--sb-text-soft)]">
            {t('login.email')}
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
            {t('login.password')}
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
          {busy ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
      <p className="text-center text-xs text-[var(--sb-text-soft)]">
        {t('login.initialAccount')}
      </p>
      <button
        type="button"
        onClick={() => void switchDemoMode(true)}
        className="touch-target flex items-center justify-center gap-2 rounded-xl border border-[var(--sb-border)] px-4 text-sm font-medium text-[var(--sb-text-soft)]"
      >
        <Sparkles size={16} aria-hidden="true" /> {t('login.tryDemo')}
      </button>
    </main>
  );
}
