import { useState } from 'react';
import { accountCreateBodySchema } from '../../../shared/contracts.ts';
import { api, ApiError } from '../../api/index.ts';
import { toast } from '../../store/useUiStore.ts';
import { ConfirmSheet } from '../../shared/components/ConfirmSheet.tsx';

const COLORS = [
  '#3ecf8e',
  '#38bdf8',
  '#a78bfa',
  '#fb7185',
  '#fbbf24',
  '#f97316',
];

/** Ajout d'un compte : le PAT part au serveur en HTTPS et n'en revient jamais. */
export function AccountForm({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [alias, setAlias] = useState('');
  const [pat, setPat] = useState('');
  const [color, setColor] = useState(COLORS[0] ?? '#3ecf8e');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const parsed = accountCreateBodySchema.safeParse({ alias, pat, color });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Saisie invalide');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createAccount(parsed.data);
      toast.success(`Compte « ${parsed.data.alias} » ajouté et vérifié ✔`);
      setAlias('');
      setPat('');
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ajout impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmSheet
      open={open}
      title="Ajouter un compte Supabase"
      confirmLabel="Tester et ajouter"
      busy={busy}
      onCancel={onClose}
      onConfirm={() => void submit()}
    >
      <div className="space-y-3 text-left">
        <label className="block">
          <span className="text-xs font-medium text-[var(--sb-text-soft)]">
            Alias lisible
          </span>
          <input
            type="text"
            value={alias}
            onChange={e => setAlias(e.target.value)}
            placeholder="Ex. Lab POC interne"
            className="mt-1 w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-[var(--sb-text-soft)]">
            Personal Access Token (sbp_…)
          </span>
          <input
            type="password"
            value={pat}
            onChange={e => setPat(e.target.value)}
            placeholder="sbp_xxxxxxxx…"
            autoComplete="off"
            className="mt-1 w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 font-mono text-sm"
          />
          <span className="mt-1 block text-xs text-[var(--sb-text-soft)]">
            Créé sur supabase.com → Account → Access Tokens. Stocké chiffré
            (AES-256-GCM) côté serveur, jamais dans ce navigateur.
          </span>
        </label>
        <div
          role="radiogroup"
          aria-label="Couleur du compte"
          className="flex gap-2"
        >
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Couleur ${c}`}
              onClick={() => setColor(c)}
              className={`size-8 rounded-full border-2 ${
                color === c ? 'border-[var(--sb-text)]' : 'border-transparent'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
        {error && <p className="text-sm text-[var(--sb-critical)]">{error}</p>}
      </div>
    </ConfirmSheet>
  );
}
