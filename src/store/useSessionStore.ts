import { create } from 'zustand';
import type { UserDto } from '../../shared/contracts.ts';
import { api, ApiError, IS_MOCK } from '../api/index.ts';

type SessionStatus = 'unknown' | 'anonymous' | 'authenticated';

interface SessionState {
  status: SessionStatus;
  user: UserDto | null;
  /** Vérifie la session au démarrage (cookie httpOnly côté serveur). */
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useSessionStore = create<SessionState>(set => ({
  status: 'unknown',
  user: null,

  async bootstrap() {
    if (IS_MOCK) {
      // Démo publique : session implicite, aucun secret en jeu.
      const user = await api.me();
      set({ status: 'authenticated', user });
      return;
    }
    try {
      const user = await api.me();
      set({ status: 'authenticated', user });
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // Hors ligne : on reste « unknown », l'app bascule en mode offline.
        set({ status: 'unknown' });
        return;
      }
      set({ status: 'anonymous', user: null });
    }
  },

  async login(email, password) {
    const user = await api.login(email, password);
    set({ status: 'authenticated', user });
  },

  async logout() {
    try {
      await api.logout();
    } finally {
      set({ status: 'anonymous', user: null });
    }
  },
}));

/** RBAC côté UI (le serveur reste l'autorité). */
export function canOperate(user: UserDto | null): boolean {
  return user?.role === 'admin' || user?.role === 'operator';
}

export function canAdmin(user: UserDto | null): boolean {
  return user?.role === 'admin';
}
