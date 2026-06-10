/**
 * Mode démo (données simulées, aucun appel Supabase) :
 * - FORCÉ au build par VITE_MOCK=1 (démo publique GitHub Pages, sans
 *   backend → impossible de basculer en réel sur ce build) ;
 * - sinon activable/désactivable À CHAUD (Réglages) via un drapeau
 *   localStorage, appliqué au rechargement (le client API est choisi au
 *   chargement du module).
 */

const DEMO_FLAG_KEY = 'miss-supaboss-demo-mode';

/** Clé de l'état persisté des fixtures de démo (possédée par mockApi). */
export const MOCK_STORAGE_KEY = 'miss-supaboss-mock-v1';

/** Mock imposé par le build (Pages) — non débrayable côté client. */
export const FORCED_MOCK = import.meta.env.VITE_MOCK === '1';

export function isDemoOverride(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** Pose/retire la surcharge. L'appelant recharge la page pour appliquer. */
export function setDemoMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEMO_FLAG_KEY, '1');
    else localStorage.removeItem(DEMO_FLAG_KEY);
  } catch {
    // stockage indisponible : la bascule ne peut pas être persistée
  }
}

/** Réinitialise les fixtures de démo (reseed au prochain chargement). */
export function resetDemoData(): void {
  try {
    localStorage.removeItem(MOCK_STORAGE_KEY);
  } catch {
    // rien à réinitialiser
  }
}

/** Évalué au chargement du module — un reload applique tout changement. */
export const IS_MOCK = FORCED_MOCK || isDemoOverride();

/**
 * Bascule complète : pose le drapeau, purge le snapshot hors-ligne (ne pas
 * mélanger données réelles et fictives) puis recharge l'application.
 */
export async function switchDemoMode(on: boolean): Promise<void> {
  setDemoMode(on);
  const { clearSnapshot } = await import('../offline/lastKnown.ts');
  await clearSnapshot();
  window.location.reload();
}
