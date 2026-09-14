/**
 * Rend le maskable Android (512) et l'icône d'accueil iOS (180).
 *
 * POURQUOI UN SVG À PART, ET PAS `pwa-icons --maskable`. Le générateur du socle
 * fabrique un maskable en RÉDUISANT la source dans la zone de sécurité, sur un
 * fond uni. Quand la source est une tuile arrondie — c'est le cas ici — le
 * résultat est cette tuile posée sur un aplat, et le raccord se voit : Android
 * en fait un liseré tout autour de l'icône. Avec `--bg` on peut rapprocher les
 * deux couleurs, jamais supprimer le raccord.
 *
 * Un maskable se DESSINE à fond perdu. `icon-maskable.svg` reprend le même
 * dégradé et le même dessin que `favicon.svg`, sans les coins arrondis et avec
 * le sujet tenu dans le disque de sécurité. Le commentaire du SVG dit ce qui en
 * diffère, et pourquoi.
 *
 * LE MÊME `--bg` FRAPPAIT L'ICÔNE APPLE, ET ELLE NE PASSAIT PAS PAR ICI.
 * `pwa-icons` écrit `apple-touch-icon.png` PAR DÉFAUT, `--maskable` ou pas. iOS
 * n'accepte pas la transparence et aplatit les coins de la tuile arrondie sur
 * `--bg` — `12,18,34` tant qu'on ne le donne pas. Mesuré sur le fichier livré
 * jusqu'au 14/09/2026 : coin à `12,18,34` quand le bord rendait `15,24,47`.
 *
 * L'ironie vaut d'être notée : `12,18,34`, c'est `#0c1222`, l'arrêt SOMBRE du
 * dégradé de cette app. Le défaut d'usine de `pwa-icons` vient d'ici. Le coin
 * bas-droit était donc juste par accident, et le haut-gauche faux — il rendait
 * l'arrêt d'en bas au lieu de `#101a33`. Deux bleus nuit : presque invisible,
 * faux quand même.
 *
 * ET POURQUOI DEUX COUCHES, PLUTÔT QUE DE RENDRE LE MASKABLE EN 180. Parce que
 * `icon-maskable.svg` réduit le dessin à 95 % pour le disque de 80 % d'Android,
 * et que le masque d'iOS — un rectangle arrondi de rayon ~22,4 % — ne demande
 * pas cette marge : la frontière la plus proche du centre y est à 110,6 px sur
 * 180, quand le dessin à taille pleine n'atteint que 71,5. Le réduire lui
 * coûterait de la présence sans rien protéger.
 *
 * On pose donc le dessin de `favicon.svg`, à sa taille PLEINE, sur le fond à
 * fond perdu du maskable. Le dégradé est le même, aux mêmes arrêts, dans le même
 * repère : les deux couches portent la même couleur en tout pixel de la tuile,
 * et le raccord n'existe pas — au lieu d'être rendu discret. Seuls les coins,
 * transparents dans la source, reçoivent enfin la bonne teinte.
 *
 * Exécuter : npm run icons:maskable
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');

// `density` : sans elle, sharp pixellise le SVG à 72 ppp AVANT de
// redimensionner, et le dégradé en ressort bandé.
const rend = (nom, taille) =>
  sharp(join(racine, 'public', nom), { density: 384 })
    .resize(taille, taille)
    .png()
    .toBuffer();

await sharp(await rend('icon-maskable.svg', 512)).toFile(
  join(racine, 'public', 'icon-maskable.png')
);

const APPLE = 180;
await sharp(await rend('icon-maskable.svg', APPLE))
  .composite([{ input: await rend('favicon.svg', APPLE) }])
  .png()
  .toFile(join(racine, 'public', 'apple-touch-icon.png'));

console.log(
  'public/icon-maskable.png (512×512) et public/apple-touch-icon.png (180×180) écrits, sans coin transparent.'
);
