/**
 * Ce que le serveur fait UNE fois au démarrage, avant d'ouvrir le port —
 * séparé de `index.ts` pour être éprouvé sans démarrer de serveur.
 */
import type { AppContext } from './context.ts';

export interface BootReport {
  /** E-mail dont la double authentification a été retirée (secours). */
  totpReset: string | null;
  /** Exécutions de planning coupées par l'arrêt précédent. */
  interruptedRuns: number;
  /** Le push est-il opérationnel (clés VAPID lisibles) ? */
  pushReady: boolean;
}

export function prepareServer(ctx: AppContext): BootReport {
  // Clés VAPID engendrées dès le premier démarrage, pas au premier abonné.
  const pushReady = ctx.notifier.vapidKeys() !== null;

  // Téléphone ET codes de secours perdus : seul qui tient le serveur peut
  // rouvrir le compte, par `SUPABOSS_TOTP_RESET=<e-mail>`. Consigné, et à
  // retirer ensuite (sinon chaque redémarrage recommence).
  let totpReset: string | null = null;
  const email = ctx.env.totpReset;
  if (email) {
    const user = ctx.store.findUserByEmail(email);
    if (user && ctx.store.getTotp(user.id)) {
      ctx.store.deleteTotp(user.id);
      ctx.store.recordOperation({
        userEmail: user.email,
        action: 'auth.totp',
        status: 'ok',
        detail:
          'Double authentification retirée au démarrage (SUPABOSS_TOTP_RESET)',
      });
      totpReset = user.email;
    }
  }

  return {
    totpReset,
    interruptedRuns: ctx.schedules.recoverInterrupted(),
    pushReady,
  };
}
