/**
 * Vue d'ensemble de la flotte : ce qui presse, compte par compte.
 *
 * Logique pure, partagée par l'accueil, l'écran Projets et la carte d'un
 * projet. AUCUNE DONNÉE NOUVELLE : tout se lit dans la flotte et les métriques
 * déjà synchronisées. Rien ici n'appelle la Management API, donc rien ne
 * s'impute sur le budget de requêtes par compte.
 *
 * Pourquoi ce module existe : dans la démo, « Sondage (archive) » n'était
 * plus restaurable que cinq jours, et rien ne le disait hors de sa fiche,
 * sous un « Détails » replié. Les alertes J-7 / J-1 n'existent qu'avec le
 * serveur, ni en démo ni en local-first. L'échéance doit donc se voir là où
 * l'on regarde.
 */
import type { AccountFleetDto, FleetDto, ProjectDto } from './contracts.ts';
import {
  ACTIVE_PROJECT_LIMIT,
  activeProjects,
  DEMO_TAG_PREFIX,
} from './guards.ts';
import {
  quotaLevel,
  usageRatio,
  type AlertThresholds,
  type MetricValue,
} from './quotas.ts';
import { statusGroup } from './status.ts';

/** Sous ce nombre de jours, l'échéance de restauration est urgente. */
export const RESTORE_URGENT_DAYS = 7;
/** Sous ce nombre de jours, elle se signale (en orange). */
export const RESTORE_SOON_DAYS = 30;

const DAY_MS = 86_400_000;

export type RestoreUrgency = 'expired' | 'urgent' | 'soon' | 'later';

export interface RestoreCountdown {
  /** ISO, telle que la flotte la porte (estimation ou réponse de l'API). */
  deadline: string;
  /** Jours restants, arrondis au supérieur : J-1 jusqu'à la dernière heure. */
  days: number;
  urgency: RestoreUrgency;
}

/**
 * Le compte à rebours d'un projet EN PAUSE vers la fin de sa fenêtre de
 * restauration ; `null` pour un projet qui tourne, ou sans date connue (un
 * projet découvert déjà en pause n'a pas de `pausedAt`).
 *
 * Un refus de l'API (`api-blocked`) vaut fenêtre close, quelle que soit la
 * date estimée.
 */
export function restoreCountdown(
  project: Pick<ProjectDto, 'status' | 'meta'>,
  now: Date = new Date()
): RestoreCountdown | null {
  if (statusGroup(project.status) !== 'paused') return null;
  const { restoreDeadline, restoreDeadlineSource } = project.meta;
  if (!restoreDeadline) return null;
  const end = Date.parse(restoreDeadline);
  if (Number.isNaN(end)) return null;
  const days = Math.ceil((end - now.getTime()) / DAY_MS);
  const urgency: RestoreUrgency =
    restoreDeadlineSource === 'api-blocked' || now.getTime() > end
      ? 'expired'
      : days <= RESTORE_URGENT_DAYS
        ? 'urgent'
        : days <= RESTORE_SOON_DAYS
          ? 'soon'
          : 'later';
  return { deadline: restoreDeadline, days, urgency };
}

/**
 * La métrique la plus remplie d'un projet, celle qu'on montre sur sa carte ;
 * `null` si aucune n'est mesurable (egress, projet en pause jamais mesuré).
 */
export function mainMetric(
  metrics: readonly MetricValue[]
): MetricValue | null {
  let best: MetricValue | null = null;
  let bestRatio = -1;
  for (const metric of metrics) {
    const ratio = usageRatio(metric);
    if (ratio !== null && ratio > bestRatio) {
      best = metric;
      bestRatio = ratio;
    }
  }
  return best;
}

/**
 * Le rang d'urgence d'un projet, du plus pressant (0) au plus calme (9).
 *
 * L'ordre suit ce qu'on perd à attendre : une erreur, puis une restauration
 * qui ne sera bientôt plus possible, puis une transition à suivre, puis un
 * quota critique. Une fenêtre déjà close vient après les quotas : il ne reste
 * qu'à télécharger la sauvegarde, et plus rien ne presse.
 */
export function urgencyRank(
  project: Pick<ProjectDto, 'status' | 'meta'>,
  metrics: readonly MetricValue[],
  thresholds: AlertThresholds,
  now: Date = new Date()
): number {
  const group = statusGroup(project.status);
  if (group === 'error') return 0;
  const countdown = restoreCountdown(project, now);
  if (countdown?.urgency === 'urgent') return 1;
  if (group === 'transition') return 2;
  const metric = mainMetric(metrics);
  const level = metric ? quotaLevel(metric, thresholds) : null;
  if (level === 'critical') return 3;
  if (countdown?.urgency === 'soon') return 4;
  if (level === 'high') return 5;
  if (level === 'warn') return 6;
  if (countdown?.urgency === 'expired') return 7;
  if (group === 'unknown') return 8;
  return 9;
}

/**
 * Trie du plus pressant au plus calme. À rang égal : l'échéance la plus
 * proche, puis la jauge la plus remplie, puis le nom.
 */
export function sortByUrgency(
  projects: readonly ProjectDto[],
  metricsFor: (project: ProjectDto) => readonly MetricValue[],
  thresholds: AlertThresholds,
  now: Date = new Date()
): ProjectDto[] {
  const keyed = projects.map(project => {
    const metrics = metricsFor(project);
    const metric = mainMetric(metrics);
    return {
      project,
      rank: urgencyRank(project, metrics, thresholds, now),
      days: restoreCountdown(project, now)?.days ?? Number.POSITIVE_INFINITY,
      ratio: metric ? (usageRatio(metric) ?? 0) : 0,
    };
  });
  keyed.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.days - b.days ||
      b.ratio - a.ratio ||
      a.project.name.localeCompare(b.project.name, 'fr')
  );
  return keyed.map(k => k.project);
}

export interface AccountSummary {
  /** Projets qui occupent une place (actifs ou en train de démarrer). */
  active: number;
  limit: number;
  /** Places encore libres, jamais négatif. */
  free: number;
  paused: number;
  total: number;
}

/** Le compte en une ligne : « 2/2 actifs · 2 en pause ». */
export function accountSummary(
  accountFleet: Pick<AccountFleetDto, 'projects'>
): AccountSummary {
  const { projects } = accountFleet;
  const active = activeProjects(projects).length;
  return {
    active,
    limit: ACTIVE_PROJECT_LIMIT,
    free: Math.max(0, ACTIVE_PROJECT_LIMIT - active),
    paused: projects.filter(p => statusGroup(p.status) === 'paused').length,
    total: projects.length,
  };
}

export interface FleetTotals {
  projects: number;
  active: number;
  /** Places offertes par les comptes ACTIVÉS (2 chacun). */
  slots: number;
  paused: number;
  /** Projets en pause à restaurer sous `RESTORE_URGENT_DAYS` jours. */
  restoreUrgent: number;
}

/** Les compteurs du bandeau de la vue d'ensemble, sur toute la flotte. */
export function fleetTotals(
  fleet: Pick<FleetDto, 'accounts'>,
  now: Date = new Date()
): FleetTotals {
  const totals: FleetTotals = {
    projects: 0,
    active: 0,
    slots: 0,
    paused: 0,
    restoreUrgent: 0,
  };
  for (const accountFleet of fleet.accounts) {
    const summary = accountSummary(accountFleet);
    totals.projects += summary.total;
    totals.active += summary.active;
    totals.paused += summary.paused;
    if (accountFleet.account.enabled) totals.slots += summary.limit;
    for (const project of accountFleet.projects) {
      if (restoreCountdown(project, now)?.urgency === 'urgent') {
        totals.restoreUrgent += 1;
      }
    }
  }
  return totals;
}

/**
 * Les projets en pause dont la fenêtre se ferme sous `horizonDays` jours,
 * échéance la plus proche d'abord. Une fenêtre déjà close n'y figure pas :
 * l'accueil ne garderait sinon qu'un rappel permanent de ce qui est perdu.
 */
export function restoreWatchlist(
  projects: readonly ProjectDto[],
  now: Date = new Date(),
  horizonDays: number = RESTORE_SOON_DAYS
): { project: ProjectDto; countdown: RestoreCountdown }[] {
  const out: { project: ProjectDto; countdown: RestoreCountdown }[] = [];
  for (const project of projects) {
    const countdown = restoreCountdown(project, now);
    if (
      countdown &&
      countdown.urgency !== 'expired' &&
      countdown.days <= horizonDays
    ) {
      out.push({ project, countdown });
    }
  }
  return out.sort((a, b) => a.countdown.days - b.countdown.days);
}

/** Le libellé d'une étiquette, sans le préfixe des données de démo. */
export function tagLabel(tag: string): string {
  return tag.startsWith(DEMO_TAG_PREFIX)
    ? tag.slice(DEMO_TAG_PREFIX.length)
    : tag;
}

/** Les étiquettes portées par ces projets, sans doublon, par libellé. */
export function collectTags(projects: readonly ProjectDto[]): string[] {
  const tags = new Set<string>();
  for (const project of projects) {
    for (const tag of project.meta.tags) tags.add(tag);
  }
  return [...tags].sort((a, b) => tagLabel(a).localeCompare(tagLabel(b), 'fr'));
}
