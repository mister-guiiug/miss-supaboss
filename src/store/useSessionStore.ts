import { create } from 'zustand';
import type { LoginTotpBody, UserDto } from '../../shared/contracts.ts';
import { api, ApiError, IS_MOCK } from '../api/index.ts';

type SessionStatus = 'unknown' | 'anonymous' | 'authenticated';

/** Issue d'une saisie du mot de passe. */
export type LoginOutcome = 'authenticated' | 'totp-required';

interface SessionState {
  status: SessionStatus;
  user: UserDto | null;
  /**
   * Mot de passe accepté, code de double authentification attendu. Aucune
   * session n'existe encore : le jeton d'étape est un cookie httpOnly.
   */
  totpPending: boolean;
  /** Vérifie la session au démarrage (cookie httpOnly côté serveur). */
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  /** Seconde étape : code de l'application ou code de secours. */
  verifySecondFactor: (factor: LoginTotpBody) => Promise<void>;
  /** Revient à la saisie du mot de passe. */
  cancelSecondFactor: () => void;
  logout: () => Promise<void>;
}

export const useSessionStore = create<SessionState>(set => ({
  status: 'unknown',
  user: null,
  totpPending: false,

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
    const result = await api.login(email, password);
    if ('totpRequired' in result) {
      set({ totpPending: true });
      return 'totp-required';
    }
    set({ status: 'authenticated', user: result.user, totpPending: false });
    return 'authenticated';
  },

  async verifySecondFactor(factor) {
    try {
      const user = await api.loginSecondFactor(factor);
      set({ status: 'authenticated', user, totpPending: false });
    } catch (error) {
      // Étape expirée ou brûlée (trop d'essais) : retour au mot de passe.
      if (error instanceof ApiError && error.code === 'totp-expired') {
        set({ totpPending: false });
      }
      throw error;
    }
  },

  cancelSecondFactor() {
    set({ totpPending: false });
  },

  async logout() {
    try {
      await api.logout();
    } finally {
      set({ status: 'anonymous', user: null, totpPending: false });
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
