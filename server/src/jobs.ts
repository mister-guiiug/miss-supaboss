/**
 * Tâche de fond du serveur, une passe par minute :
 *
 * 1. les plannings dus (`ScheduleService.runDue`) ;
 * 2. toutes les `SUPABOSS_SYNC_INTERVAL_MIN` minutes, une synchro de la
 *    flotte — la Management API seule (`GET /v1/projects`), jamais la base
 *    des projets. Elle tient à jour les dates de pause observées et déclenche
 *    l'évaluation des alertes de fin de fenêtre de restauration même quand
 *    personne n'a l'app ouverte.
 *
 * Les QUOTAS ne sont collectés en fond que sur demande
 * (`SUPABOSS_SYNC_METRICS=1`) : leur collecte interroge la BASE de chaque
 * projet actif, et rien ne documente si Supabase la compte comme de
 * l'activité — ce qui retarderait sa mise en pause automatique. Sans ce
 * réglage, les alertes de quota sont évaluées à chaque collecte déclenchée
 * par l'app.
 *
 * Une passe ne chevauche jamais la précédente : une synchro lente (réseau,
 * nouvelles tentatives) repousse la suivante au lieu de s'y empiler.
 */
import type { Env } from './env.ts';
import type { FleetService } from './fleet.ts';
import type { ScheduleService } from './schedules.ts';

export const JOB_TICK_MS = 60_000;

export interface BackgroundJobsDeps {
  env: Pick<Env, 'syncIntervalMin' | 'syncMetrics'>;
  fleet: FleetService;
  schedules: ScheduleService;
  onError?: (error: unknown, what: string) => void;
}

export class BackgroundJobs {
  private readonly deps: BackgroundJobsDeps;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastSyncAt = Number.NEGATIVE_INFINITY;

  constructor(deps: BackgroundJobsDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), JOB_TICK_MS);
    // Ne retient pas le processus : l'arrêt reste piloté par SIGTERM.
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Une passe. Sans effet si la précédente tourne encore. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    const report = this.deps.onError ?? (() => undefined);
    try {
      try {
        await this.deps.schedules.runDue(now);
      } catch (error) {
        report(error, 'plannings');
      }
      const interval = this.deps.env.syncIntervalMin * 60_000;
      if (interval > 0 && now.getTime() - this.lastSyncAt >= interval) {
        this.lastSyncAt = now.getTime();
        try {
          await this.deps.fleet.getFleet(true);
          if (this.deps.env.syncMetrics) {
            await this.deps.fleet.getFleetMetrics(false);
          }
        } catch (error) {
          report(error, 'synchro de fond');
        }
      }
    } finally {
      this.running = false;
    }
  }
}
