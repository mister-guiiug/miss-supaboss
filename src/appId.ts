/**
 * Identifiant de l'app dans le catalogue famille (`apps-catalog` du socle).
 *
 * C'est AUSSI le nom du dépôt GitHub : `repoUrl(APP_ID)` et `pagesUrl(APP_ID)`
 * en dérivent les URL, et `appById(APP_ID)` la fiche (nom, maturité, icône).
 * Une faute de frappe ne casserait rien à la compilation — elle produirait
 * simplement un lien 404. D'où `appId.test.ts`, qui confronte la valeur au
 * catalogue et à l'URL réelle du dépôt.
 *
 * Ce module a remplacé `links.ts`, qui recopiait en dur l'URL du dépôt et le
 * lien sponsor de la famille.
 */
export const APP_ID = 'miss-supaboss';
