/**
 * Plannings de pause / restauration — calcul PUR des échéances, partagé par
 * le serveur (qui les exécute) et le mock de la démo (qui les affiche).
 *
 * Une échéance s'écrit en HEURE MURALE dans un fuseau IANA : « vendredi
 * 19:00 » reste 19:00 à Paris, été comme hiver. C'est ce que l'utilisateur a
 * en tête ; un instant UTC figé glisserait d'une heure au changement d'heure.
 * La conversion passe par `Intl.DateTimeFormat`, sans dépendance.
 *
 * Changement d'heure — même règle que `Temporal` (« compatible ») :
 *   - une heure qui N'EXISTE PAS (02:30 le jour du passage à l'heure d'été)
 *     est repoussée de la durée du saut (03:30) ;
 *   - une heure qui existe DEUX FOIS (02:30 au retour à l'heure d'hiver)
 *     prend la première occurrence.
 */

/** Fuseau par défaut des plannings : celui de l'équipe qui a commandé l'outil. */
export const DEFAULT_SCHEDULE_TIMEZONE = 'Europe/Paris';

export type ScheduleAction = 'pause' | 'restore';

/** Heure murale, mois de 1 à 12. */
export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Règle d'un planning : ponctuel (date-heure) ou hebdomadaire (jour + heure). */
export type ScheduleRule =
  | { kind: 'once'; at: string; timezone: string }
  | { kind: 'weekly'; weekday: number; time: string; timezone: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DDTHH:mm` — la valeur d'un `<input type="datetime-local">`. */
export const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** `HH:mm`, de 00:00 à 23:59. */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Un formateur par fuseau, gardé : en construire un est coûteux, et le
 * calcul d'une échéance en demande une dizaine.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Heure murale, dans `timeZone`, d'un instant UTC. */
export function wallTimeAt(
  utcMs: number,
  timeZone: string
): WallTime & { second: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(p => p.type === type)?.value ?? Number.NaN);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // `% 24` : certains moteurs rendent encore « 24 » pour minuit.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Décalage du fuseau (ms, heure murale − UTC) à un instant donné. */
function offsetAt(utcMs: number, timeZone: string): number {
  const w = wallTimeAt(utcMs, timeZone);
  const asUtc = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function sameWallMinute(utcMs: number, wall: WallTime, timeZone: string) {
  const w = wallTimeAt(utcMs, timeZone);
  return (
    w.year === wall.year &&
    w.month === wall.month &&
    w.day === wall.day &&
    w.hour === wall.hour &&
    w.minute === wall.minute
  );
}

/**
 * Heure murale → instant UTC (ms).
 *
 * Les deux décalages possibles sont ceux de la veille et du lendemain : un
 * changement d'heure tombe forcément entre les deux. Chaque candidat est
 * vérifié en le reconvertissant ; aucun ne tombe juste → l'heure est dans le
 * trou du passage à l'heure d'été, et le décalage d'AVANT la repousse d'autant.
 */
export function zonedTimeToUtc(wall: WallTime, timeZone: string): number {
  const local = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute
  );
  const before = offsetAt(local - DAY_MS, timeZone);
  const after = offsetAt(local + DAY_MS, timeZone);
  const candidates = [...new Set([before, after])]
    .map(offset => local - offset)
    .filter(utc => sameWallMinute(utc, wall, timeZone));
  if (candidates.length > 0) return Math.min(...candidates);
  return local - before;
}

/** `YYYY-MM-DDTHH:mm` → heure murale, ou null si la date n'existe pas (31/02). */
export function parseLocalDateTime(value: string): WallTime | null {
  const m = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (hour > 23 || minute > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

/** `HH:mm` → [heure, minute], ou null. */
export function parseTimeOfDay(value: string): [number, number] | null {
  const m = TIME_OF_DAY_PATTERN.exec(value);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

/** Jour ISO d'une date civile : lundi = 1 … dimanche = 7. */
function isoWeekday(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return ((d + 6) % 7) + 1;
}

/**
 * Prochaine échéance STRICTEMENT après `afterMs`, ou null pour un planning
 * ponctuel déjà passé (ou une règle illisible).
 */
export function nextRunAt(rule: ScheduleRule, afterMs: number): number | null {
  if (rule.kind === 'once') {
    const wall = parseLocalDateTime(rule.at);
    if (!wall) return null;
    const utc = zonedTimeToUtc(wall, rule.timezone);
    return utc > afterMs ? utc : null;
  }

  const time = parseTimeOfDay(rule.time);
  if (!time || rule.weekday < 1 || rule.weekday > 7) return null;
  const today = wallTimeAt(afterMs, rule.timezone);
  // Huit jours suffisent : si l'heure du jour J est passée, J+7 est le suivant.
  for (let offset = 0; offset <= 7; offset += 1) {
    const civil = new Date(
      Date.UTC(today.year, today.month - 1, today.day + offset)
    );
    const year = civil.getUTCFullYear();
    const month = civil.getUTCMonth() + 1;
    const day = civil.getUTCDate();
    if (isoWeekday(year, month, day) !== rule.weekday) continue;
    const utc = zonedTimeToUtc(
      { year, month, day, hour: time[0], minute: time[1] },
      rule.timezone
    );
    if (utc > afterMs) return utc;
  }
  return null;
}

/**
 * Une échéance manquée de plus d'une heure (serveur arrêté, veille…) n'est
 * PAS rattrapée : restaurer lundi soir un projet prévu pour lundi 8 h
 * surprendrait plus qu'il n'aiderait. Elle est consignée comme manquée.
 */
export const SCHEDULE_GRACE_MS = 60 * 60 * 1000;

/** Nombre maximal de plannings par projet (garde-fou contre l'emballement). */
export const MAX_SCHEDULES_PER_PROJECT = 10;
