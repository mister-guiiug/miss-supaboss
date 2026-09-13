// @vitest-environment node
/**
 * `loadEnv` n'avait aucun test — 0 % — alors qu'il prend `process.env` en
 * PARAMÈTRE, précisément pour être appelable sans toucher à l'environnement
 * du processus.
 *
 * Ce qu'il décide n'est pas anodin : `mock` choisit entre le faux fournisseur
 * et la vraie Management API, et `secureCookies` décide si le cookie de
 * session porte l'attribut `Secure`. Les deux se lisent sur des CHAÎNES, où
 * `'false'` est vrai en JavaScript — c'est exactement le genre d'inversion
 * qu'aucun type ne rattrape.
 */
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.ts';

describe('loadEnv — les valeurs par défaut', () => {
  it('un environnement vide donne une configuration locale complète', () => {
    expect(loadEnv({})).toEqual({
      port: 8787,
      host: '127.0.0.1',
      dataDir: './data',
      masterKey: undefined,
      adminEmail: 'admin@local',
      adminPassword: undefined,
      mock: false,
      secureCookies: false,
      apiBudgetPerMin: 50,
      production: false,
    });
  });

  it('le budget par défaut reste sous la limite documentée de soixante', () => {
    expect(loadEnv({}).apiBudgetPerMin).toBeLessThan(60);
  });
});

describe('loadEnv — les drapeaux lus sur des chaînes', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false], // la chaîne non vide qui piégerait un simple Boolean()
    ['', false],
    ['oui', false],
  ])('SUPABOSS_MOCK=%o → mock %s', (valeur, attendu) => {
    expect(loadEnv({ SUPABOSS_MOCK: valeur }).mock).toBe(attendu);
  });

  it.each([
    ['1', true],
    ['true', true],
    ['false', false],
    ['', false],
  ])('SUPABOSS_SECURE_COOKIES=%o → secureCookies %s', (valeur, attendu) => {
    expect(loadEnv({ SUPABOSS_SECURE_COOKIES: valeur }).secureCookies).toBe(
      attendu
    );
  });

  it('absents, les deux drapeaux valent faux', () => {
    const env = loadEnv({});

    expect(env.mock).toBe(false);
    expect(env.secureCookies).toBe(false);
  });

  it('`production` ne vaut que pour NODE_ENV exactement « production »', () => {
    expect(loadEnv({ NODE_ENV: 'production' }).production).toBe(true);
    expect(loadEnv({ NODE_ENV: 'prod' }).production).toBe(false);
    expect(loadEnv({ NODE_ENV: 'test' }).production).toBe(false);
    expect(loadEnv({}).production).toBe(false);
  });
});

describe('loadEnv — ce qui est normalisé et ce qui est refusé', () => {
  it('l’adresse de l’administrateur est mise en minuscules', () => {
    // La connexion compare l'adresse telle que saisie : sans cette
    // normalisation, l'administrateur déclaré en majuscules au premier
    // démarrage ne pourrait plus se connecter.
    expect(
      loadEnv({ SUPABOSS_ADMIN_EMAIL: 'Admin@Exemple.FR' }).adminEmail
    ).toBe('admin@exemple.fr');
  });

  it('le port est converti depuis sa chaîne', () => {
    expect(loadEnv({ SUPABOSS_PORT: '9000' }).port).toBe(9000);
  });

  it.each(['0', '65536', 'huit-mille'])(
    'un port invalide (%s) fait ÉCHOUER le démarrage',
    valeur => {
      // Mieux vaut refuser de démarrer que d'écouter sur un port arbitraire.
      expect(() => loadEnv({ SUPABOSS_PORT: valeur })).toThrow();
    }
  );

  it.each(['0', '61'])(
    'un budget hors des bornes (%s) fait ÉCHOUER le démarrage',
    valeur => {
      // Au-delà de 60, Supabase répondrait 429 à tout le compte ; en dessous
      // de 1, plus aucune requête ne partirait.
      expect(() => loadEnv({ SUPABOSS_API_BUDGET_PER_MIN: valeur })).toThrow();
    }
  );

  it('les secrets optionnels restent indéfinis plutôt que vides', () => {
    // `masterKey: ''` ferait générer une clé maître à chaque démarrage, et
    // toutes les sessions comme tous les PAT deviendraient illisibles.
    const env = loadEnv({});

    expect(env.masterKey).toBeUndefined();
    expect(env.adminPassword).toBeUndefined();
  });
});
