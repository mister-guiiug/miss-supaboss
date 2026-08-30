import { describe, expect, it } from 'vitest';
import { appById, repoUrl } from '@mister-guiiug/dev-wpa-config/apps-catalog';
import { APP_ID } from './appId.ts';

/**
 * Les liens « Code source » et « M'offrir un café » de l'écran Réglages ne
 * viennent plus d'une copie locale : `FamilyApps` les dérive du catalogue à
 * partir du seul `APP_ID`. Le compilateur n'a rien à dire d'une chaîne mal
 * orthographiée — elle donnerait un lien GitHub en 404 et une carte absente.
 * C'est ce que ces deux assertions attrapent.
 */
describe("identité de l'app dans le catalogue famille", () => {
  it('correspond à une entrée du catalogue', () => {
    expect(appById(APP_ID)?.name).toBe('Miss Supaboss');
  });

  it('donne bien l’URL du dépôt GitHub réel', () => {
    expect(repoUrl(APP_ID)).toBe(
      'https://github.com/mister-guiiug/miss-supaboss'
    );
  });
});
