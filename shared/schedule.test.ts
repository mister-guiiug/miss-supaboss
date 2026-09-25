import { describe, expect, it } from 'vitest';
import {
  isValidTimeZone,
  nextRunAt,
  parseLocalDateTime,
  parseTimeOfDay,
  wallTimeAt,
  zonedTimeToUtc,
} from './schedule.ts';

const utc = (iso: string): number => Date.parse(iso);

describe('zonedTimeToUtc — heure murale → instant', () => {
  it('Paris en hiver (UTC+1) puis en été (UTC+2)', () => {
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 1, day: 16, hour: 19, minute: 0 },
        'Europe/Paris'
      )
    ).toBe(utc('2026-01-16T18:00:00Z'));
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 7, day: 10, hour: 19, minute: 0 },
        'Europe/Paris'
      )
    ).toBe(utc('2026-07-10T17:00:00Z'));
  });

  it('une heure qui n’existe pas (passage à l’heure d’été) est repoussée', () => {
    // 29/03/2026 : 02:00 → 03:00 à Paris. 02:30 n'existe pas → 03:30 CEST.
    const at = zonedTimeToUtc(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
      'Europe/Paris'
    );
    expect(at).toBe(utc('2026-03-29T01:30:00Z'));
    expect(wallTimeAt(at, 'Europe/Paris')).toMatchObject({
      hour: 3,
      minute: 30,
    });
  });

  it('même règle à l’ouest de Greenwich (New York, 08/03/2026)', () => {
    const at = zonedTimeToUtc(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      'America/New_York'
    );
    expect(wallTimeAt(at, 'America/New_York')).toMatchObject({
      hour: 3,
      minute: 30,
    });
  });

  it('une heure qui existe deux fois prend la première occurrence', () => {
    // 25/10/2026 : 03:00 → 02:00. 02:30 a lieu à 00:30Z (CEST) puis 01:30Z.
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 10, day: 25, hour: 2, minute: 30 },
        'Europe/Paris'
      )
    ).toBe(utc('2026-10-25T00:30:00Z'));
  });
});

describe('nextRunAt — hebdomadaire', () => {
  const vendredi19h = {
    kind: 'weekly' as const,
    weekday: 5,
    time: '19:00',
    timezone: 'Europe/Paris',
  };

  it('le vendredi suivant, à 19:00 heure de Paris', () => {
    // Mercredi 23/09/2026 → vendredi 25/09/2026 19:00 CEST.
    expect(nextRunAt(vendredi19h, utc('2026-09-23T10:00:00Z'))).toBe(
      utc('2026-09-25T17:00:00Z')
    );
  });

  it('le jour même si l’heure n’est pas passée, sinon la semaine suivante', () => {
    expect(nextRunAt(vendredi19h, utc('2026-09-25T16:59:00Z'))).toBe(
      utc('2026-09-25T17:00:00Z')
    );
    // STRICTEMENT après : l'échéance elle-même n'est pas « à venir ».
    expect(nextRunAt(vendredi19h, utc('2026-09-25T17:00:00Z'))).toBe(
      utc('2026-10-02T17:00:00Z')
    );
  });

  it('garde 19:00 murales à travers le changement d’heure', () => {
    expect(nextRunAt(vendredi19h, utc('2026-10-23T18:00:00Z'))).toBe(
      // 30/10 : heure d'hiver revenue, 19:00 CET = 18:00Z.
      utc('2026-10-30T18:00:00Z')
    );
  });

  it('une règle illisible ne produit pas d’échéance', () => {
    expect(nextRunAt({ ...vendredi19h, time: '25:00' }, Date.now())).toBeNull();
    expect(nextRunAt({ ...vendredi19h, weekday: 8 }, Date.now())).toBeNull();
  });
});

describe('nextRunAt — ponctuel', () => {
  it('à venir : l’instant ; passé : rien', () => {
    const rule = {
      kind: 'once' as const,
      at: '2026-09-25T19:00',
      timezone: 'Europe/Paris',
    };
    expect(nextRunAt(rule, utc('2026-09-25T12:00:00Z'))).toBe(
      utc('2026-09-25T17:00:00Z')
    );
    expect(nextRunAt(rule, utc('2026-09-25T17:00:00Z'))).toBeNull();
  });
});

describe('analyse des saisies', () => {
  it('rejette une date qui n’existe pas', () => {
    expect(parseLocalDateTime('2026-02-30T10:00')).toBeNull();
    expect(parseLocalDateTime('2026-02-28T10:00')).toEqual({
      year: 2026,
      month: 2,
      day: 28,
      hour: 10,
      minute: 0,
    });
    expect(parseLocalDateTime('28/02/2026 10:00')).toBeNull();
  });

  it('heure du jour', () => {
    expect(parseTimeOfDay('07:05')).toEqual([7, 5]);
    expect(parseTimeOfDay('24:00')).toBeNull();
  });

  it('fuseaux IANA', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
