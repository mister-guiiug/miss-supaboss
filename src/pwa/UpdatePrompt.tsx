import { registerSW } from 'virtual:pwa-register';
import { UpdatePromptBanner } from '@mister-guiiug/dev-pwa-config/react/update-prompt-banner';

/**
 * Bandeau « Mise à jour disponible » : le composant du socle, avec SES
 * libellés, posé au-dessus de la BottomNav.
 *
 * LE REPORT Y GAGNE SA DURÉE. L'app passait `snoozeLabel={t('update.later')}`,
 * c'est-à-dire « Plus tard » tout court, alors qu'elle reporte de 24 heures.
 * Le libellé du socle est `Plus tard ({hours} h)` et remplit `{hours}` avec
 * `snoozeHours` : le bouton annonce désormais ce qu'il fait.
 *
 * `registerSW` est indispensable : c'est LUI qui enregistre le service worker
 * et branche `onNeedRefresh`. Sans injection, le bandeau ne s'afficherait
 * jamais — avec `registerType: 'prompt'`, le nouveau worker attendrait
 * indéfiniment. Cet import coupe aussi l'auto-injection de registerSW.js
 * (`injectRegister: 'auto'`) : l'enregistrement passe par le composant.
 */
export function UpdatePrompt() {
  return (
    <UpdatePromptBanner
      checkEvery="1h"
      registerSW={registerSW}
      snoozeHours={24}
      // `components.css` habille la boîte (fond, filet, rayon, cibles
      // tactiles) mais pas sa PLACE : le bandeau doit flotter AU-DESSUS de la
      // BottomNav (≈ 3,7 rem) et de la zone sûre iOS, sinon il recouvre les
      // onglets et masque ses propres boutons.
      className="fixed inset-x-4 bottom-[calc(max(env(safe-area-inset-bottom),0px)+4.5rem)] z-40 mx-auto max-w-sm shadow-lg"
    />
  );
}
