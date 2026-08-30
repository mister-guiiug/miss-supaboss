/**
 * Formatage d'affichage propre à miss-supaboss — sans dépendance UI.
 *
 * CE QUI N'EST PLUS ICI. `formatBytes`, `formatCount` et `formatUsage` sont
 * partis au socle (`@mister-guiiug/dev-wpa-config/format`) — c'est d'ici
 * que `formatCount` et `formatUsage` ont été promus. Les copies assemblaient
 * leurs chaînes à la main avec une virgule décimale française FIGÉE : l'app se
 * traduit pourtant en anglais, où « 1,5 kB » et « 1,2k » sont faux.
 *
 * CE QUI RESTE ICI, ET POURQUOI. Trois adaptateurs minces. Chacun garde une
 * règle que le socle n'a pas, et délègue le rendu du nombre ou de la date :
 *
 * - `formatPercent` : décimales VARIABLES (une sous 10 %, aucune au-dessus) —
 *   `formatPercentage` prend un nombre de décimales fixe ;
 * - `formatRelative` : un libellé pour « jamais mesuré », qui n'est pas
 *   « il y a 0 seconde » ;
 * - `formatDateTime` : un tiret pour l'absence de date, et le format court
 *   NUMÉRIQUE (`30/08/2026 16:05`) d'un tableau dense.
 *
 * Aucun ne code plus de locale : le socle suit celle que `createI18n` pose via
 * `setDefaultLocale` à chaque changement de langue.
 */
import {
  formatDateTime as formatDateTimeIntl,
  formatPercentage,
  formatRelativeTime,
} from '@mister-guiiug/dev-wpa-config/format';

/**
 * Date courte NUMÉRIQUE. Le socle part de `month: 'short'` (« 30 août 2026 ») ;
 * ces options-ci écrasent le défaut. Impossible de passer par
 * `dateStyle: 'short'` : `formatDate` pose déjà `year`/`month`/`day`, et
 * `Intl.DateTimeFormat` refuse le mélange des deux familles d'options.
 */
const SHORT_DATE: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};

/**
 * Ratio → pourcentage lisible (`62 %`, `6,2 %`, `—`).
 *
 * Sous 10 %, une décimale : sur un quota, « 6,2 % » et « 6 % » ne disent pas la
 * même chose. Au-dessus, la décimale est du bruit.
 */
export function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—';
  return formatPercentage(ratio, undefined, ratio < 0.1 ? 1 : 0);
}

/**
 * Date ISO → « il y a 3 minutes », « hier », « 3 hours ago »…
 *
 * `never` est OBLIGATOIRE : la valeur nulle veut dire « jamais mesuré », et ce
 * libellé doit être traduit. Le rendre obligatoire est ce qui garantit qu'aucun
 * appelant ne réintroduise le « jamais » français dans une interface anglaise —
 * c'est exactement ce que faisait la version précédente.
 */
export function formatRelative(
  iso: string | null,
  options: { never: string; now?: Date }
): string {
  if (!iso) return options.never;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return options.never;
  return formatRelativeTime(t, undefined, options.now ?? new Date());
}

/** Date ISO → `30/08/2026 16:05`, ou un tiret si la date manque. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return formatDateTimeIntl(t, undefined, SHORT_DATE);
}
