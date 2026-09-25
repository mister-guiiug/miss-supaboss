import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { qrToDataUrl } from '@mister-guiiug/dev-pwa-config/qr';
import type {
  TotpEnrollmentDto,
  TotpStatusDto,
} from '../../../shared/contracts.ts';
import { api, ApiError } from '../../api/index.ts';
import { useI18n } from '../../i18n/index.ts';
import { toast } from '../../store/useUiStore.ts';

/** Champ de saisie : contour à 3:1 (WCAG 1.4.11) et cible de 44 px. */
const INPUT =
  'mt-1 min-h-11 w-full rounded-xl border border-[var(--dwc-border-strong)] bg-transparent px-3 py-2.5 text-sm';

/** « JBSWY3DPEHPK3PXP… » → « JBSW Y3DP EHPK 3PXP … » : recopiable à la main. */
function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

type Step =
  | { kind: 'idle' }
  | { kind: 'enrolling'; enrollment: TotpEnrollmentDto; qr: string | null }
  | { kind: 'codes'; codes: string[] };

/**
 * Double authentification dans les Réglages : activer (QR code + clé en
 * clair + premier code), montrer UNE fois les codes de secours, désactiver
 * (mot de passe + code). Serveur seulement : ailleurs, une phrase le dit.
 */
export function TotpSection() {
  const { t } = useI18n();
  const controller = api.totp;
  const [status, setStatus] = useState<TotpStatusDto | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Annonce polie (`aria-live`) des changements d'état. */
  const [notice, setNotice] = useState('');
  /**
   * À chaque étape, le focus va à sa CONSIGNE (tabIndex -1), pas au champ :
   * sur mobile, focaliser le champ ouvrirait le clavier par-dessus le QR code
   * qu'il faut d'abord scanner.
   */
  const stepHeadingRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (step.kind !== 'idle') stepHeadingRef.current?.focus();
  }, [step.kind]);

  useEffect(() => {
    if (!controller) return;
    let alive = true;
    controller
      .status()
      .then(s => alive && setStatus(s))
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, [controller]);

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('totp.copied'));
    } catch {
      toast.error(t('totp.copyFail'));
    }
  };

  const fail = (e: unknown): void =>
    setError(e instanceof ApiError ? e.message : t('totp.failed'));

  const startEnrollment = async (): Promise<void> => {
    if (!controller) return;
    setBusy(true);
    setError(null);
    try {
      const enrollment = await controller.enroll();
      // Le QR se calcule dans le navigateur (le module `uqr` arrive à la
      // demande) ; s'il manque, la clé en clair suffit — on le dit.
      let qr: string | null = null;
      try {
        qr = await qrToDataUrl(enrollment.otpauthUri, {
          width: 208,
          margin: 4,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        });
      } catch {
        qr = null;
      }
      setCode('');
      setStep({ kind: 'enrolling', enrollment, qr });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const activate = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!controller) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError(t('totp.invalidCode'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const codes = await controller.activate(code.trim());
      setStep({ kind: 'codes', codes });
      setStatus(await controller.status());
      setNotice(t('totp.enabledNotice'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!controller) return;
    setBusy(true);
    setError(null);
    try {
      await controller.disable(password, disableCode.trim());
      setPassword('');
      setDisableCode('');
      setStatus(await controller.status());
      setNotice(t('totp.disabledNotice'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3 p-4" aria-label={t('totp.aria')}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
        <KeyRound size={15} aria-hidden="true" /> {t('totp.heading')}
      </h2>
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {!controller ? (
        <p className="text-xs text-[var(--sb-text-soft)]">
          {t('totp.serverOnly')}
        </p>
      ) : loadFailed ? (
        <p className="text-sm text-[var(--sb-warn)]">{t('totp.loadFail')}</p>
      ) : status === null ? (
        <p className="text-xs text-[var(--sb-text-soft)]">
          {t('common.loading')}
        </p>
      ) : step.kind === 'codes' ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">{t('totp.recoveryTitle')}</h3>
          <p
            ref={stepHeadingRef}
            tabIndex={-1}
            className="text-xs text-[var(--sb-warn)]"
          >
            {t('totp.recoveryIntro')}
          </p>
          <ol className="grid grid-cols-2 gap-1.5 font-mono text-sm">
            {step.codes.map(c => (
              <li
                key={c}
                className="rounded-lg bg-[var(--sb-surface-2)] px-2 py-1 text-center"
              >
                {c}
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void copy(step.codes.join('\n'))}
              className="touch-target flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--dwc-border-strong)] px-3 text-sm font-medium"
            >
              <Copy size={16} aria-hidden="true" /> {t('totp.copyCodes')}
            </button>
            <button
              type="button"
              onClick={() => setStep({ kind: 'idle' })}
              className="touch-target flex-1 rounded-xl bg-primary px-3 text-sm font-semibold text-[#06281a]"
            >
              {t('totp.recoveryDone')}
            </button>
          </div>
        </div>
      ) : status.enabled ? (
        <form className="space-y-3" onSubmit={e => void disable(e)}>
          <p className="flex items-start gap-1.5 text-sm">
            <ShieldCheck
              size={16}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-[var(--sb-ok)]"
            />
            {t('totp.on', { count: status.recoveryCodesLeft })}
          </p>
          {status.recoveryCodesLeft <= 2 && (
            <p className="text-xs text-[var(--sb-warn)]">
              {t('totp.lowCodes')}
            </p>
          )}
          <p className="text-xs text-[var(--sb-text-soft)]">
            {t('totp.disableIntro')}
          </p>
          <label className="block">
            <span className="text-xs font-medium text-[var(--sb-text-soft)]">
              {t('totp.password')}
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--sb-text-soft)]">
              {t('totp.disableCode')}
            </span>
            <input
              type="text"
              required
              minLength={6}
              autoComplete="one-time-code"
              autoCapitalize="off"
              spellCheck={false}
              value={disableCode}
              onChange={e => setDisableCode(e.target.value)}
              className={`${INPUT} font-mono`}
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
            className="touch-target flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--sb-critical)] px-4 text-sm font-semibold text-[var(--sb-critical)] disabled:opacity-50"
          >
            <ShieldOff size={16} aria-hidden="true" /> {t('totp.disable')}
          </button>
        </form>
      ) : step.kind === 'enrolling' ? (
        <form className="space-y-3" onSubmit={e => void activate(e)}>
          <p
            ref={stepHeadingRef}
            tabIndex={-1}
            className="text-xs text-[var(--sb-text-soft)]"
          >
            {t('totp.scan')}
          </p>
          {step.qr ? (
            // Fond blanc imposé : un QR en thème sombre se lit mal.
            <img
              src={step.qr}
              alt={t('totp.qrAlt')}
              width={208}
              height={208}
              className="mx-auto rounded-xl bg-white"
            />
          ) : (
            <p className="text-xs text-[var(--sb-warn)]">{t('totp.qrFail')}</p>
          )}
          <div>
            <p className="text-xs font-medium text-[var(--sb-text-soft)]">
              {t('totp.keyLabel')}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-lg bg-[var(--sb-surface-2)] px-2 py-2 font-mono text-sm break-all">
                {groupKey(step.enrollment.secret)}
              </code>
              <button
                type="button"
                onClick={() => void copy(step.enrollment.secret)}
                aria-label={t('totp.copyKey')}
                className="touch-target flex items-center justify-center rounded-xl border border-[var(--dwc-border-strong)]"
              >
                <Copy size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-[var(--sb-text-soft)]">
              {t('totp.codeLabel')}
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={e => setCode(e.target.value)}
              className={`${INPUT} font-mono tracking-widest`}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-[var(--sb-critical)]">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep({ kind: 'idle' });
              }}
              className="touch-target flex-1 rounded-xl border border-[var(--dwc-border-strong)] px-3 text-sm font-medium"
            >
              {t('totp.cancel')}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="touch-target flex-1 rounded-xl bg-primary px-3 text-sm font-semibold text-[#06281a] disabled:opacity-50"
            >
              {t('totp.confirm')}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">{t('totp.off')}</p>
          <p className="text-xs text-[var(--sb-text-soft)]">
            {t('totp.intro')}
          </p>
          {error && (
            <p role="alert" className="text-sm text-[var(--sb-critical)]">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void startEnrollment()}
            className="touch-target flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-[#06281a] disabled:opacity-50"
          >
            <ShieldCheck size={16} aria-hidden="true" /> {t('totp.enable')}
          </button>
        </div>
      )}
    </section>
  );
}
