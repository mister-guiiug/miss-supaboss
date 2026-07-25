import { NavLink } from 'react-router-dom';
import {
  Gauge,
  LayoutDashboard,
  Server,
  Settings,
  UsersRound,
} from 'lucide-react';
import { useI18n } from '../../i18n/index.ts';

// « Comptes » est une destination de 1er niveau (objet métier racine : un projet
// appartient à un compte) → 2e position, sous le pouce. L'Historique (consultatif,
// non quotidien) est relogé en tête de Réglages pour rester à 5 onglets.
const ITEMS = [
  { to: '/', labelKey: 'nav.home', icon: LayoutDashboard, end: true },
  { to: '/accounts', labelKey: 'nav.accounts', icon: UsersRound, end: false },
  { to: '/projects', labelKey: 'nav.projects', icon: Server, end: false },
  { to: '/quotas', labelKey: 'nav.quotas', icon: Gauge, end: false },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings, end: false },
] as const;

export function BottomNav() {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t('nav.aria')}
      className="card fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-2xl grid-cols-5 rounded-none border-x-0 border-b-0 pb-safe"
    >
      {ITEMS.map(({ to, labelKey, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `touch-target flex flex-col items-center justify-center gap-0.5 py-2 text-[0.7rem] font-medium ${
              isActive ? 'text-primary' : 'text-[var(--sb-text-soft)]'
            }`
          }
        >
          <Icon size={22} aria-hidden="true" />
          {t(labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
