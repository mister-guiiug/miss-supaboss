/**
 * Plannings de pause / restauration (« mettre en pause vendredi soir »).
 *
 * L'EXÉCUTION passe par `FleetService`, donc par les MÊMES garde-fous qu'un
 * clic : un projet déjà en pause n'est pas « re-pausé », et une restauration
 * qui ferait un troisième projet actif est REFUSÉE (la limite Free des deux
 * actifs), sans pause automatique d'un autre projet pour faire de la place —
 * un planning ne décide pas à la place d'un humain de ce qui s'arrête.
 *
 * Chaque exécution est consignée dans l'historique, qu'elle ait abouti, été
 * refusée par un garde-fou, échoué, ou été manquée.
 *
 * AU PLUS UNE FOIS : l'échéance est avancée en base AVANT d'agir
 * (`claimScheduleRun`). Deux passes qui se croisent ne jouent pas deux fois la
 * même, et un arrêt du serveur pendant l'exécution ne la rejoue pas au
 * redémarrage — elle est close comme « interrompue ».
 */
import type {
  ScheduleCreateInput,
  ScheduleDto,
} from '../../shared/contracts.ts';
import {
  MAX_SCHEDULES_PER_PROJECT,
  SCHEDULE_GRACE_MS,
  nextRunAt,
  type ScheduleRule,
} from '../../shared/schedule.ts';
import type { ScheduleRunStatus, Store, UserRow } from './db.ts';
import { FleetError, type FleetService } from './fleet.ts';

const WEEKDAYS_FR = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
];

function ruleOf(s: ScheduleDto): ScheduleRule | null {
  if (s.kind === 'once' && s.at) {
    return { kind: 'once', at: s.at, timezone: s.timezone };
  }
  if (s.kind === 'weekly' && s.weekday !== null && s.time) {
    return {
      kind: 'weekly',
      weekday: s.weekday,
      time: s.time,
      timezone: s.timezone,
    };
  }
  return null;
}

/** « Pause chaque vendredi à 19:00 (Europe/Paris) » — pour l'historique. */
export function describeSchedule(
  s: Pick<
    ScheduleDto,
    'action' | 'kind' | 'at' | 'weekday' | 'time' | 'timezone'
  >
): string {
  const action = s.action === 'pause' ? 'Pause' : 'Restauration';
  if (s.kind === 'weekly') {
    const day = WEEKDAYS_FR[(s.weekday ?? 1) - 1] ?? '?';
    return `${action} chaque ${day} à ${s.time ?? '?'} (${s.timezone})`;
  }
  const [date = '', time = ''] = (s.at ?? '').split('T');
  const [y, m, d] = date.split('-');
  return `${action} le ${d}/${m}/${y} à ${time} (${s.timezone})`;
}

/**
 * Libellé d'un refus. Certains codes de garde-fou portent un message
 * générique (« Restauration impossible ») : le code dit mieux pourquoi.
 */
function refusalText(error: FleetError): string {
  switch (error.code) {
    case 'already-active':
      return 'projet déjà actif';
    case 'not-restorable':
      return 'projet pas en pause';
    case 'unknown-project':
      return 'projet introuvable';
    default:
      return error.message;
  }
}

export interface ScheduleServiceOptions {
  /** Retard au-delà duquel une échéance est déclarée manquée. */
  graceMs?: number;
}

export class ScheduleService {
  private readonly store: Store;
  private readonly fleet: FleetService;
  private readonly graceMs: number;

  constructor(
    store: Store,
    fleet: FleetService,
    options: ScheduleServiceOptions = {}
  ) {
    this.store = store;
    this.fleet = fleet;
    this.graceMs = options.graceMs ?? SCHEDULE_GRACE_MS;
  }

  list(accountId: string, ref: string): ScheduleDto[] {
    return this.store.listSchedules(accountId, ref);
  }

  create(
    user: UserRow,
    accountId: string,
    ref: string,
    input: ScheduleCreateInput,
    nowMs: number = Date.now()
  ): ScheduleDto {
    const account = this.store.getAccount(accountId);
    if (!account) {
      throw new FleetError(404, 'account-not-found', 'Compte introuvable');
    }
    // Un projet jamais vu par une synchro n'a rien à planifier.
    if (!this.store.getProjectMeta(accountId, ref)) {
      throw new FleetError(
        404,
        'project-not-found',
        `Projet ${ref} introuvable`
      );
    }
    if (
      this.store.countSchedules(accountId, ref) >= MAX_SCHEDULES_PER_PROJECT
    ) {
      throw new FleetError(
        409,
        'too-many-schedules',
        `${MAX_SCHEDULES_PER_PROJECT} plannings au plus par projet`
      );
    }
    const fields =
      input.kind === 'once'
        ? {
            kind: 'once' as const,
            at: input.at,
            weekday: null,
            time: null,
          }
        : {
            kind: 'weekly' as const,
            at: null,
            weekday: input.weekday,
            time: input.time,
          };
    const rule: ScheduleRule =
      input.kind === 'once'
        ? { kind: 'once', at: input.at, timezone: input.timezone }
        : {
            kind: 'weekly',
            weekday: input.weekday,
            time: input.time,
            timezone: input.timezone,
          };
    const next = nextRunAt(rule, nowMs);
    if (next === null) {
      throw new FleetError(
        400,
        'schedule-in-past',
        'Cette échéance est déjà passée'
      );
    }
    const schedule = this.store.insertSchedule({
      accountId,
      ref,
      action: input.action,
      ...fields,
      timezone: input.timezone,
      nextRunAt: new Date(next).toISOString(),
      createdBy: user.email,
    });
    this.store.recordOperation({
      userEmail: user.email,
      action: 'schedule.create',
      accountId,
      accountAlias: account.alias,
      projectRef: ref,
      projectName: this.fleet.cachedProjectName(accountId, ref),
      status: 'ok',
      detail: describeSchedule(schedule),
    });
    return schedule;
  }

  remove(user: UserRow, accountId: string, ref: string, id: string): void {
    const schedule = this.store.getSchedule(id);
    if (!schedule || schedule.accountId !== accountId || schedule.ref !== ref) {
      throw new FleetError(404, 'schedule-not-found', 'Planning introuvable');
    }
    this.store.deleteSchedule(id);
    this.store.recordOperation({
      userEmail: user.email,
      action: 'schedule.delete',
      accountId,
      accountAlias: this.store.getAccount(accountId)?.alias ?? null,
      projectRef: ref,
      projectName: this.fleet.cachedProjectName(accountId, ref),
      status: 'ok',
      detail: describeSchedule(schedule),
    });
  }

  /**
   * Une passe : joue ce qui est dû à `now`. IDEMPOTENTE — relancée aussitôt,
   * elle ne trouve plus rien (les échéances ont avancé). Rend le nombre
   * d'échéances traitées (jouées, refusées, manquées).
   */
  async runDue(now: Date = new Date()): Promise<number> {
    let handled = 0;
    for (const schedule of this.store.listDueSchedules(now.toISOString())) {
      const due = schedule.nextRunAt;
      const rule = ruleOf(schedule);
      if (!due) continue;
      // Hebdomadaire : l'échéance suivante STRICTEMENT après maintenant — les
      // semaines éventuellement sautées (serveur arrêté) ne s'accumulent pas.
      const next =
        schedule.kind === 'weekly' && rule
          ? nextRunAt(rule, now.getTime())
          : null;
      const claimed = this.store.claimScheduleRun(
        schedule.id,
        due,
        next === null ? null : new Date(next).toISOString(),
        now.toISOString()
      );
      if (!claimed) continue; // une autre passe l'a pris
      handled += 1;

      if (now.getTime() - Date.parse(due) > this.graceMs) {
        const detail = `Échéance du ${due.slice(0, 16).replace('T', ' ')} UTC manquée (serveur arrêté ?), non rattrapée`;
        this.store.finishScheduleRun(schedule.id, 'missed', detail);
        this.recordRun(schedule, `${describeSchedule(schedule)} — ${detail}`);
        continue;
      }
      await this.execute(schedule);
    }
    return handled;
  }

  private async execute(schedule: ScheduleDto): Promise<void> {
    const actor = `planning:${schedule.createdBy}`;
    const origin = `Planning — ${describeSchedule(schedule)}`;
    try {
      if (schedule.action === 'pause') {
        await this.fleet.pause(actor, schedule.accountId, schedule.ref, origin);
      } else {
        await this.fleet.restore(
          actor,
          schedule.accountId,
          schedule.ref,
          { pauseFirst: [], force: false },
          origin
        );
      }
      this.store.finishScheduleRun(
        schedule.id,
        'ok',
        'Demande acceptée par Supabase'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 4xx : un garde-fou a dit non AVANT tout appel à Supabase, rien n'a
      // été consigné — c'est à nous de le faire. 5xx : l'appel a échoué, et
      // `FleetService` a déjà clos son opération en erreur.
      const refused = error instanceof FleetError && error.statusCode < 500;
      const logged = error instanceof FleetError && error.statusCode >= 500;
      const status: ScheduleRunStatus = refused ? 'refused' : 'error';
      const reason = refused
        ? `refusé par un garde-fou : ${refusalText(error)}`
        : `échec : ${message}`;
      this.store.finishScheduleRun(schedule.id, status, reason);
      if (!logged) this.recordRun(schedule, `${origin} — ${reason}`);
    }
  }

  /** Consigne une exécution qui n'a pas atteint Supabase (refus, oubli). */
  private recordRun(schedule: ScheduleDto, detail: string): void {
    this.store.recordOperation({
      userEmail: `planning:${schedule.createdBy}`,
      action: schedule.action === 'pause' ? 'project.pause' : 'project.restore',
      accountId: schedule.accountId,
      accountAlias: this.store.getAccount(schedule.accountId)?.alias ?? null,
      projectRef: schedule.ref,
      projectName: this.fleet.cachedProjectName(
        schedule.accountId,
        schedule.ref
      ),
      status: 'error',
      detail,
    });
  }

  /**
   * Au démarrage : une exécution restée « en cours » a été coupée par
   * l'arrêt du processus. Elle n'est PAS rejouée (la demande a pu partir
   * chez Supabase) ; elle est close et signalée.
   */
  recoverInterrupted(): number {
    const interrupted = this.store.listRunningSchedules();
    for (const schedule of interrupted) {
      const detail =
        'Exécution interrompue par un arrêt du serveur : résultat inconnu, vérifiez le statut du projet';
      this.store.finishScheduleRun(schedule.id, 'error', detail);
      this.recordRun(schedule, `${describeSchedule(schedule)} — ${detail}`);
    }
    return interrupted.length;
  }
}
