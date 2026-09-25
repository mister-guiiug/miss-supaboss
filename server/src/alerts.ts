/**
 * Alertes, évaluées CÔTÉ SERVEUR à chaque synchro (`FleetService.onSync`) :
 *
 * - QUOTAS : au franchissement À LA HAUSSE d'un niveau (seuils de
 *   l'utilisateur, 70/85/95 % par défaut). Une alerte par niveau et par
 *   période de quota (le mois) : une jauge qui oscille autour de 85 % ne
 *   sonne pas à chaque synchro, et un saut direct de 60 à 96 % n'envoie que
 *   « critique ».
 * - FENÊTRE DE RESTAURATION (§3 point 4 du README) : J-7 puis J-1 avant
 *   `pausedAt + fenêtre`, une fois chacune par épisode de pause. Un projet
 *   découvert déjà en pause (date inconnue) ne déclenche rien : on
 *   n'invente pas d'échéance.
 *
 * Les marques anti-spam sont posées AVANT l'envoi : au plus une fois,
 * jamais deux, même si deux synchros se croisent. Les évaluations sont en
 * outre mises en FILE (une à la fois) : aucune ne lit la marque qu'une autre
 * est en train de poser.
 */
import { estimateRestoreDeadline } from '../../shared/guards.ts';
import {
  GB,
  KB,
  MB,
  METRIC_LABELS,
  quotaLevel,
  type MetricValue,
  type QuotaLevel,
} from '../../shared/quotas.ts';
import type { SettingsDto } from '../../shared/contracts.ts';
import type { Store, UserRow } from './db.ts';
import type { FleetService, FleetSyncEvent } from './fleet.ts';
import type {
  NotificationMessage,
  NotificationService,
} from './notify/service.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rang d'un niveau : ce qui est comparé à la marque déjà posée. */
const LEVEL_RANK: Record<Exclude<QuotaLevel, 'ok'>, number> = {
  warn: 1,
  high: 2,
  critical: 3,
};

const LEVEL_LABEL: Record<Exclude<QuotaLevel, 'ok'>, string> = {
  warn: 'd’avertissement',
  high: 'élevé',
  critical: 'critique',
};

/** Rangs de la fenêtre de restauration. */
const RESTORE_J7 = 1;
const RESTORE_J1 = 2;

export interface AlertServiceOptions {
  /** Où rapporter une évaluation qui a échoué (défaut : console). */
  onError?: (error: unknown) => void;
}

export class AlertService {
  private readonly store: Store;
  private readonly notifier: NotificationService;
  private readonly onError: (error: unknown) => void;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    store: Store,
    notifier: NotificationService,
    options: AlertServiceOptions = {}
  ) {
    this.store = store;
    this.notifier = notifier;
    this.onError =
      options.onError ??
      (error => console.error('Évaluation des alertes impossible :', error));
  }

  /** Branche l'évaluation sur les synchros de la flotte. */
  attach(fleet: FleetService): void {
    fleet.onSync(event => this.enqueue(event));
  }

  /** Met une évaluation en file ; la synchro qui l'a émise n'attend pas. */
  enqueue(event: FleetSyncEvent): void {
    this.queue = this.queue
      .then(() => this.evaluate(event))
      .then(
        () => undefined,
        error => this.onError(error)
      );
  }

  /** Attend la fin des évaluations en file (tests, arrêt propre). */
  idle(): Promise<void> {
    return this.queue;
  }

  /** Évalue un événement de synchro ; rend le nombre d'alertes émises. */
  async evaluate(event: FleetSyncEvent, now: Date = new Date()) {
    const recipients = this.store.listAlertRecipients();
    let sent = 0;
    for (const user of recipients) {
      const settings = this.store.getSettings(user.id);
      const messages =
        event.type === 'metrics'
          ? this.quotaAlerts(user, settings, event.items, now)
          : this.restoreAlerts(user, settings, event, now);
      for (const message of messages) {
        await this.notifier.deliver(user, message);
        sent += 1;
      }
    }
    return sent;
  }

  private quotaAlerts(
    user: UserRow,
    settings: SettingsDto,
    items: Extract<FleetSyncEvent, { type: 'metrics' }>['items'],
    now: Date
  ): NotificationMessage[] {
    const out: NotificationMessage[] = [];
    for (const item of items) {
      for (const metric of item.metrics) {
        // Seule une mesure FRAÎCHE peut franchir un seuil : une valeur
        // « dernier état connu » (projet en pause) n'a pas bougé.
        if (metric.state !== 'measured' && metric.state !== 'estimated') {
          continue;
        }
        const level = quotaLevel(metric, settings.thresholds);
        if (level === null || level === 'ok') continue;
        const claimed = this.store.claimAlertMark({
          userId: user.id,
          accountId: item.accountId,
          ref: item.ref,
          subject: `quota:${metric.kind}`,
          period: (metric.measuredAt ?? now.toISOString()).slice(0, 7),
          rank: LEVEL_RANK[level],
        });
        if (!claimed) continue;
        out.push(quotaMessage(item, metric, level, settings));
      }
    }
    return out;
  }

  private restoreAlerts(
    user: UserRow,
    settings: SettingsDto,
    event: Extract<FleetSyncEvent, { type: 'fleet' }>,
    now: Date
  ): NotificationMessage[] {
    const out: NotificationMessage[] = [];
    for (const project of event.projects) {
      if (project.status !== 'INACTIVE' || !project.meta.pausedAt) continue;
      const deadline = estimateRestoreDeadline(
        project.meta.pausedAt,
        settings.restoreWindowDays
      );
      if (!deadline) continue;
      const left = Date.parse(deadline) - now.getTime();
      // Échéance passée : plus rien d'utile à annoncer.
      if (left <= 0) continue;
      const rank =
        left <= DAY_MS ? RESTORE_J1 : left <= 7 * DAY_MS ? RESTORE_J7 : 0;
      if (rank === 0) continue;
      const claimed = this.store.claimAlertMark({
        userId: user.id,
        accountId: event.account.id,
        ref: project.ref,
        subject: 'restore-window',
        // Un nouvel épisode de pause repart de zéro.
        period: project.meta.pausedAt,
        rank,
      });
      if (!claimed) continue;
      out.push(
        restoreMessage(
          event.account,
          project.ref,
          project.name,
          project.meta.pausedAt,
          deadline,
          rank,
          settings.restoreWindowDays
        )
      );
    }
    return out;
  }
}

/* ── Rédaction (le serveur parle français, comme ses messages d'erreur) ── */

const dateFr = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeZone: 'Europe/Paris',
});

function formatAmount(kind: MetricValue['kind'], value: number): string {
  if (kind === 'mau') {
    return `${new Intl.NumberFormat('fr-FR').format(value)} MAU`;
  }
  if (value >= GB) return `${(value / GB).toFixed(1).replace('.', ',')} Go`;
  if (value >= MB) return `${Math.round(value / MB)} Mo`;
  return `${Math.round(value / KB)} Ko`;
}

function quotaMessage(
  item: Extract<FleetSyncEvent, { type: 'metrics' }>['items'][number],
  metric: MetricValue,
  level: Exclude<QuotaLevel, 'ok'>,
  settings: SettingsDto
): NotificationMessage {
  const pct = Math.round(((metric.value ?? 0) / metric.quota) * 100);
  const label = METRIC_LABELS[metric.kind];
  return {
    event: 'quota.threshold',
    title: `${label} à ${pct} % — ${item.name}`,
    body: `Seuil ${LEVEL_LABEL[level]} (${settings.thresholds[level]} %) franchi sur « ${item.accountAlias} » : ${formatAmount(metric.kind, metric.value ?? 0)} / ${formatAmount(metric.kind, metric.quota)}.`,
    path: `#/projects/${encodeURIComponent(item.accountId)}/${encodeURIComponent(item.ref)}`,
    tag: `quota:${item.accountId}:${item.ref}:${metric.kind}`,
    level,
    project: {
      accountId: item.accountId,
      accountAlias: item.accountAlias,
      ref: item.ref,
      name: item.name,
    },
  };
}

function restoreMessage(
  account: { id: string; alias: string },
  ref: string,
  name: string,
  pausedAt: string,
  deadline: string,
  rank: number,
  windowDays: number
): NotificationMessage {
  const when = rank === RESTORE_J1 ? 'J-1' : 'J-7';
  return {
    event: 'restore.window',
    title: `${when} avant la fin de la fenêtre de restauration — ${name}`,
    body: `En pause depuis le ${dateFr.format(Date.parse(pausedAt))} (« ${account.alias} ») : restaurable jusqu’au ${dateFr.format(Date.parse(deadline))} environ (estimation, fenêtre de ${windowDays} jours).`,
    path: `#/projects/${encodeURIComponent(account.id)}/${encodeURIComponent(ref)}`,
    tag: `restore:${account.id}:${ref}`,
    level: when,
    project: { accountId: account.id, accountAlias: account.alias, ref, name },
  };
}
