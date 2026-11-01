import {
  scorePassphrase,
  type PassphraseStrength,
} from '../../api/crypto/passphraseStrength.ts';
import { useI18n } from '../../i18n/index.ts';

const BAR: Record<PassphraseStrength, string> = {
  weak: 'w-1/4 bg-[var(--sb-critical)]',
  fair: 'w-1/2 bg-[var(--sb-warn)]',
  good: 'w-3/4 bg-[var(--sb-high)]',
  strong: 'w-full bg-[var(--sb-ok)]',
};

/**
 * Champ phrase + barre d’entropie — coffre, export, activation.
 */
export function PassphraseField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  autoComplete = 'new-password',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  autoComplete?: string;
}) {
  const { t } = useI18n();
  const { strength } = scorePassphrase(value);

  return (
    <div className="space-y-1.5">
      <input
        type="password"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-label={ariaLabel}
        className="w-full rounded-xl border border-[var(--sb-border)] bg-transparent px-3 py-2.5 text-sm"
      />
      {value.length > 0 && (
        <div className="space-y-1" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--sb-surface-2)]">
            <div className={`h-full transition-all ${BAR[strength]}`} />
          </div>
          <p className="text-xs text-[var(--sb-text-soft)]">
            {t(`settings.passphraseStrength.${strength}`)}
          </p>
        </div>
      )}
    </div>
  );
}
