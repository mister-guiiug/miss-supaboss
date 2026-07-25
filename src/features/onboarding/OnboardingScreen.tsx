import { useState } from 'react';
import { Hand, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { IS_MOCK, PROXY_BASE } from '../../api/index.ts';
import { useFleetStore } from '../../store/useFleetStore.ts';
import { canAdmin, useSessionStore } from '../../store/useSessionStore.ts';
import { useI18n } from '../../i18n/index.ts';
import type { Messages } from '../../i18n/messages.ts';
import { AccountForm } from '../accounts/AccountForm.tsx';

/**
 * Note de sécurité selon le mode RÉELLEMENT déployé : l'ancienne copie promettait
 * un chiffrement « côté serveur, jamais dans ce navigateur » — faux en local-first,
 * où le PAT vit dans le navigateur et n'est transmis qu'au proxy de relais. Le
 * texte est traduit via `textKey` ; icône et teinte restent invariantes.
 */
const securityNote: {
  icon: typeof Sparkles;
  tone: string;
  textKey: keyof Messages['onboarding']['security'];
} = IS_MOCK
  ? { icon: Sparkles, tone: 'text-primary', textKey: 'demo' }
  : PROXY_BASE
    ? {
        icon: ShieldAlert,
        tone: 'text-[var(--sb-warn)]',
        textKey: 'localFirst',
      }
    : { icon: ShieldCheck, tone: 'text-primary', textKey: 'server' };

/** Premier lancement : aucun compte → guide d'ajout du premier PAT. */
export function OnboardingScreen() {
  const { t } = useI18n();
  const loadFleet = useFleetStore(s => s.loadFleet);
  const user = useSessionStore(s => s.user);
  const [formOpen, setFormOpen] = useState(false);
  const NoteIcon = securityNote.icon;

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-5 px-2 py-10 text-center">
      <Hand size={44} aria-hidden="true" className="text-primary" />
      <h1 className="text-xl font-bold">{t('onboarding.welcome')}</h1>
      <ol className="card w-full space-y-3 p-5 text-left text-sm">
        <li className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
          >
            1
          </span>
          <span>
            {t('onboarding.step1.pre')} <strong>supabase.com</strong>{' '}
            {t('onboarding.step1.mid')} <strong>Personal Access Token</strong>{' '}
            {t('onboarding.step1.post')}
          </span>
        </li>
        <li className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
          >
            2
          </span>
          <span>{t('onboarding.step2')}</span>
        </li>
        <li className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
          >
            3
          </span>
          <span>{t('onboarding.step3')}</span>
        </li>
      </ol>
      <p className="flex items-start gap-2 text-left text-xs text-[var(--sb-text-soft)]">
        <NoteIcon
          size={28}
          aria-hidden="true"
          className={`shrink-0 ${securityNote.tone}`}
        />
        {t(`onboarding.security.${securityNote.textKey}`)}
      </p>
      {canAdmin(user) ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="touch-target w-full rounded-xl bg-primary px-4 font-semibold text-[#06281a]"
        >
          {t('onboarding.addFirst')}
        </button>
      ) : (
        <p className="text-sm text-[var(--sb-text-soft)]">
          {t('onboarding.askAdmin')}
        </p>
      )}
      <AccountForm
        open={formOpen}
        account={null}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void loadFleet(true);
        }}
      />
    </div>
  );
}
