import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useFleetStore } from '../../store/useFleetStore.ts';
import { canAdmin, useSessionStore } from '../../store/useSessionStore.ts';
import { AccountForm } from '../accounts/AccountForm.tsx';

/** Premier lancement : aucun compte → guide d'ajout du premier PAT. */
export function OnboardingScreen() {
  const loadFleet = useFleetStore(s => s.loadFleet);
  const user = useSessionStore(s => s.user);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-5 px-2 py-10 text-center">
      <span aria-hidden="true" className="text-5xl">
        👋
      </span>
      <h1 className="text-xl font-bold">Bienvenue dans Miss Supaboss</h1>
      <ol className="card w-full space-y-3 p-5 text-left text-sm">
        <li className="flex gap-2">
          <span aria-hidden="true">1️⃣</span>
          <span>
            Sur <strong>supabase.com</strong> → Account → Access Tokens, créez
            un <strong>Personal Access Token</strong> par compte gratuit.
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true">2️⃣</span>
          <span>
            Ajoutez chaque compte ici avec un alias parlant (« Lab POC », «
            Démos clients »…).
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true">3️⃣</span>
          <span>
            Visualisez les projets actifs/en pause, les quotas Free Plan, et
            préparez vos démos en un geste.
          </span>
        </li>
      </ol>
      <p className="flex items-start gap-2 text-left text-xs text-[var(--sb-text-soft)]">
        <ShieldCheck
          size={28}
          aria-hidden="true"
          className="shrink-0 text-primary"
        />
        Les PAT sont chiffrés (AES-256-GCM) côté serveur et n'atteignent jamais
        ce navigateur. Chaque action est journalisée.
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
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void loadFleet(true);
        }}
      />
    </div>
  );
}
