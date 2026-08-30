/**
 * Tests d'USAGE des trois adaptateurs restés locaux.
 *
 * Les tests de `formatBytes`, `formatCount` et `formatUsage` ont disparu :
 * ces fonctions sont désormais celles du socle, qui les éprouve chez lui.
 * Ce qui se teste ici, c'est ce que l'app ajoute — décimales variables, libellé
 * « jamais », tiret d'absence — ET le fait que tout cela suive la langue.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  getDefaultLocale,
  setDefaultLocale,
} from '@mister-guiiug/dev-wpa-config/format';
import { formatDateTime, formatPercent, formatRelative } from './format.ts';

// La locale par défaut du socle est un état de module : la reposer évite qu'un
// test en contamine un autre.
const initial = getDefaultLocale();
afterEach(() => setDefaultLocale(initial));

/**
 * `Intl` sépare le nombre de son unité par une espace insécable — ORDINAIRE
 * (U+00A0) avant « % », ÉTROITE (U+202F) avant « Mo ». Le choix appartient à
 * l'ICU du moteur et peut bouger d'une version de Node à l'autre : comparer
 * l'octet exact rendrait ces tests fragiles sans rien éprouver de plus.
 */
const norm = (text: string) => text.replace(/\s/gu, ' ');

describe('formatPercent', () => {
  it('garde une décimale sous 10 %, aucune au-dessus', () => {
    expect(norm(formatPercent(0.62))).toBe('62 %');
    expect(norm(formatPercent(0.062))).toBe('6,2 %');
  });

  it('rend un tiret quand le ratio n’existe pas', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
  });

  it('suit la langue de l’app', () => {
    setDefaultLocale('en-GB');
    expect(norm(formatPercent(0.062))).toBe('6.2%');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-06-10T12:00:00Z');
  const never = 'jamais';

  it('rend l’ancienneté dans la langue courante', () => {
    expect(norm(formatRelative('2026-06-10T11:58:00Z', { now, never }))).toBe(
      'il y a 2 minutes'
    );
    expect(norm(formatRelative('2026-06-10T09:00:00Z', { now, never }))).toBe(
      'il y a 3 heures'
    );
    setDefaultLocale('en-GB');
    expect(norm(formatRelative('2026-06-10T09:00:00Z', { now, never }))).toBe(
      '3 hours ago'
    );
  });

  it('rend le libellé « jamais » de l’appelant, absent ou illisible', () => {
    expect(formatRelative(null, { now, never })).toBe('jamais');
    expect(formatRelative('pas une date', { now, never })).toBe('jamais');
    expect(formatRelative(null, { now, never: 'never' })).toBe('never');
  });
});

describe('formatDateTime', () => {
  // Midi UTC : la date reste le 30 quel que soit le fuseau du runner.
  const noon = '2026-08-30T12:00:00Z';

  it('rend une date courte NUMÉRIQUE, dans la langue courante', () => {
    expect(norm(formatDateTime(noon))).toMatch(/^30\/08\/2026 \d{2}:\d{2}$/);
    setDefaultLocale('en-GB');
    expect(norm(formatDateTime(noon))).toMatch(/^30\/08\/2026, \d{2}:\d{2}$/);
  });

  it('rend un tiret quand la date manque ou est illisible', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('pas une date')).toBe('—');
  });
});
