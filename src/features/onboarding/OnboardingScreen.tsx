import { useState } from 'react';
import { Hand, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { IS_MOCK, PROXY_BASE } from '../../api/index.ts';
import { useFleetStore } from '../../store/useFleetStore.ts';
import { canAdmin, useSessionStore } from '../../store/useSessionStore.ts';
import { AccountForm } from '../accounts/AccountForm.tsx';

/**
 * Note de sécurité selon le mode RÉELLEMENT déployé : l'ancienne copie promettait
 * un chiffrement « côté serveur, jamais dans ce navigateur » — faux en local-first,
 * où le PAT vit dans le navigateur et n'est transmis qu'au proxy de relais.
 */
const securityNote = IS_MOCK
  ? {
      icon: Sparkles,
      tone: 'text-primary',
      text: 'Mode démo : comptes et données simulés. Rien n’est envoyé à Supabase.',
    }
  : PROXY_BASE
    ? {
        icon: ShieldAlert,
        tone: 'text-[var(--sb-warn)]',
        text: 'Mode local-first : le PAT est stocké sur CET appareil (dans le navigateur) et n’est transmis qu’au proxy de relais, en HTTPS. À éviter sur un poste partagé ; supprimer le compte l’efface.',
      }
    : {
        icon: ShieldCheck,
        tone: 'text-primary',
        text: 'Les PAT sont chiffrés (AES-256-GCM) côté serveur et n’atteignent jamais ce navigateur. Chaque action est journalisée.',
      };

/** Premier lancement : aucun compte → guide d'ajout du premier PAT. */
export function OnboardingScreen() {
  const loadFleet = useFleetStore(s => s.loadFleet);
  const user = useSessionStore(s => s.user);
  const [formOpen, setFormOpen] = useState(false);
  const NoteIcon = securityNote.icon;

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-5 px-2 py-10 text-center">
      <Hand size={44} aria-hidden="true" className="text-primary" />
      <h1 className="text-xl font-bold">Bienvenue dans Miss Supaboss</h1>
      <ol className="card w-full space-y-3 p-5 text-left text-sm">
        <li className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
          >
            1
          </span>
          <span>
            Sur <strong>supabase.com</strong> → Account → Access Tokens, créez
            un <strong>Personal Access Token</strong> par compte gratuit.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
          >
            2
          </span>
          <span>
            Ajoutez chaque compte ici avec un alias parlant (« Lab POC », «
            Démos clients »…).
          </span>
        </li>
        <li className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
          >
            3
          </span>
          <span>
            Visualisez les projets actifs/en pause, les quotas Free Plan, et
            préparez vos démos en un geste.
          </span>
        </li>
      </ol>
      <p className="flex items-start gap-2 text-left text-xs text-[var(--sb-text-soft)]">
        <NoteIcon
          size={28}
          aria-hidden="true"
          className={`shrink-0 ${securityNote.tone}`}
        />
        {securityNote.text}
      </p>
      {canAdmin(user) ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="touch-target w-full rounded-xl bg-primary px-4 font-semibold text-[#06281a]"
        >
          Ajouter mon premier compte
        </button>
      ) : (
        <p className="text-sm text-[var(--sb-text-soft)]">
          Demandez à un admin d'ajouter le premier compte.
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
