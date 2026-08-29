/**
 * Double de `virtual:pwa-register` pour les tests.
 *
 * Le module virtuel n'existe que dans un build servi par vite-plugin-pwa :
 * hors de là, il est irrésolvable, et un test qui importe `UpdatePrompt`
 * échoue avant d'avoir rien éprouvé. Ce double inerte lui donne un corps ;
 * les tests qui s'intéressent au comportement le remplacent par `vi.mock`.
 */
export function registerSW(_options?: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}
