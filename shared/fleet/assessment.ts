import type { ProjectDto, RestoreAssessmentDto } from '../contracts.ts';
import {
  evaluateRestore,
  type ProjectLite,
  type RestoreAssessment,
} from '../guards.ts';
import type { SupabaseProjectStatus } from '../status.ts';
import type { LiteProject } from './types.ts';

/** Convertit des DTO en projets légers pour les garde-fous. */
export function toLiteProjects<P extends ProjectDto>(
  projects: readonly P[]
): LiteProject<P>[] {
  return projects.map(dto => ({
    ref: dto.ref,
    name: dto.name,
    status: dto.status,
    favorite: dto.meta.favorite,
    demoFrequent: dto.meta.demoFrequent,
    tags: dto.meta.tags,
    lastSeenActiveAt: dto.meta.lastSeenActiveAt,
    dto,
  }));
}

/** Simule l'effet des pauses préalables avant d'évaluer le garde-fou. */
export function projectWithPrepauses<P extends ProjectLite>(
  projects: readonly P[],
  pauseFirst: readonly string[],
  targetRef: string
): P[] {
  return projects.map(p =>
    pauseFirst.includes(p.ref) && p.ref !== targetRef
      ? { ...p, status: 'INACTIVE' as SupabaseProjectStatus }
      : p
  );
}

/** Évalue la restauration (avec projection optionnelle des pauses préalables). */
export function assessRestore<P extends ProjectLite>(
  projects: readonly P[],
  targetRef: string,
  pauseFirst: readonly string[] = []
): RestoreAssessment<P> {
  const projected = pauseFirst.length
    ? projectWithPrepauses(projects, pauseFirst, targetRef)
    : projects;
  return evaluateRestore(projected, targetRef);
}

export function toRestoreAssessmentDto<P extends LiteProject>(
  assessment: RestoreAssessment<P>
): RestoreAssessmentDto {
  return {
    allowed: assessment.allowed,
    reason: assessment.reason,
    activeCount: assessment.activeCount,
    limit: assessment.limit,
    suggestions: assessment.suggestions.map(s => s.dto),
  };
}
