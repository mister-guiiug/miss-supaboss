import { NavLink } from 'react-router-dom';
import {
  Gauge,
  History,
  LayoutDashboard,
  Server,
  Settings,
} from 'lucide-react';

const ITEMS = [
  { to: '/', label: 'Accueil', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projets', icon: Server, end: false },
  { to: '/quotas', label: 'Quotas', icon: Gauge, end: false },
  { to: '/history', label: 'Historique', icon: History, end: false },
  { to: '/settings', label: 'Réglages', icon: Settings, end: false },
] as const;

export function BottomNav() {
  return (
    <nav
      aria-label="Navigation principale"
      className="card fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-2xl grid-cols-5 rounded-none border-x-0 border-b-0 pb-safe"
    >
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
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
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
