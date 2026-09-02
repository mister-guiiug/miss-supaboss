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

/** Build PWA (Pages, sans backend Fastify) : VITE_MOCK=1 au build. */
export const FORCED_MOCK = import.meta.env.VITE_MOCK === '1';

/** URL du proxy CORS Supabase (mode réel local-first sur le build PWA). */
export const PROXY_BASE = (import.meta.env.VITE_SUPABASE_PROXY ?? '').trim();

/**
 * Le mode RÉEL est-il atteignable sur ce build ?
 * - build auto-hébergé (VITE_MOCK absent) → oui, via le backend Fastify ;
 * - build PWA (VITE_MOCK=1) → oui SEULEMENT si un proxy Supabase est configuré
 *   (VITE_SUPABASE_PROXY) ; sinon la PWA reste en démo (aucun backend joignable).
 */
export const REAL_AVAILABLE = !FORCED_MOCK || PROXY_BASE !== '';

export function isDemoOverride(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** Pose la surcharge démo (1) / réel (0). L'appelant recharge pour appliquer. */
export function setDemoMode(on: boolean): void {
  try {
    localStorage.setItem(DEMO_FLAG_KEY, on ? '1' : '0');
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

/**
 * Données d'EXEMPLE (« démo ») sur le build local/PWA : faut-il pré-charger des
 * fixtures de démonstration ? Par défaut OUI (mise en avant de l'app au premier
 * lancement). À OFF, le store local démarre VIDE — l'utilisateur saisit ses
 * propres données, stockées sur l'appareil (localStorage). Indépendant du
 * choix mock/réel : ici on est déjà en mock (PWA locale), seul le SEED change.
 */
const DEMO_SEED_KEY = 'miss-supaboss-demo-seed';

export function isDemoSeed(): boolean {
  try {
    return localStorage.getItem(DEMO_SEED_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Active/désactive les données d'exemple : mémorise le choix, PURGE le store
 * local (fixtures fraîches si ON, état vide si OFF) puis recharge l'app.
 */
export async function setDemoSeed(on: boolean): Promise<void> {
  try {
    localStorage.setItem(DEMO_SEED_KEY, on ? '1' : '0');
  } catch {
    // stockage indisponible
  }
  resetDemoData();
  const { clearSnapshot } = await import('../offline/lastKnown.ts');
  await clearSnapshot();
  window.location.reload();
}

/**
 * Mock (démo) vs réel — évalué au chargement du module (un reload applique
 * tout changement). Démo FORCÉE si le réel est inatteignable (PWA sans proxy).
 * Sinon : drapeau explicite '1'/'0', à défaut le défaut du build (démo ON en
 * PWA pour la mise en avant, OFF en auto-hébergé).
 */
function isDemoActive(): boolean {
  if (!REAL_AVAILABLE) return true;
  try {
    const flag = localStorage.getItem(DEMO_FLAG_KEY);
    if (flag === '1') return true;
    if (flag === '0') return false;
  } catch {
    // stockage indisponible → défaut du build
  }
  return FORCED_MOCK;
}

export const IS_MOCK = isDemoActive();

/**
 * Bascule complète du mode démo : pose/retire le drapeau, purge le snapshot
 * hors-ligne (ne pas mélanger données réelles et fictives), REMET LES FIXTURES
 * À NEUF puis recharge. Le reseed à chaque bascule garantit qu'« activer la
 * démo » repart toujours d'un état propre et que la désactivation ne laisse
 * aucune donnée fictive résiduelle. (Un simple rechargement de page NE remet
 * pas à zéro : la démo en cours survit aux reloads — seul un toggle reseed.)
 */
export async function switchDemoMode(on: boolean): Promise<void> {
  setDemoMode(on);
  const { clearSnapshot } = await import('../offline/lastKnown.ts');
  await clearSnapshot();
  // Juste avant le reload (fenêtre minimale) : démo neuve à chaque bascule.
  resetDemoData();
  window.location.reload();
}
