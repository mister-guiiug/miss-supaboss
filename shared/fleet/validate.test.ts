import { describe, expect, it } from 'vitest';
import type { ProjectDto } from '../contracts.ts';
import { assessRestore, toLiteProjects } from './assessment.ts';
import {
  pausesBeforeRestore,
  validatePause,
  validateRestore,
} from './validate.ts';

function project(
  ref: string,
  status: ProjectDto['status'],
  overrides: Partial<ProjectDto['meta']> = {}
): ProjectDto {
  return {
    accountId: 'acc-1',
    ref,
    name: ref,
    region: 'eu-west-1',
    organizationSlug: 'org',
    organizationName: 'Org',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: {
      tags: [],
      favorite: false,
      demoFrequent: false,
      notes: '',
      lastSeenActiveAt: null,
      pausedAt: null,
      restoreDeadline: null,
      ...overrides,
    },
  };
}

describe('validatePause', () => {
  it('refuse un projet introuvable', () => {
    const f = validatePause(undefined, 'missing');
    expect(f?.code).toBe('project-not-found');
    expect(f?.status).toBe(404);
  });

  it('refuse un projet non pausable', () => {
    const f = validatePause({ name: 'P', status: 'INACTIVE' }, 'p');
    expect(f?.code).toBe('not-pausable');
  });
});

describe('validateRestore', () => {
  const base = [
    project('a', 'ACTIVE_HEALTHY'),
    project('b', 'ACTIVE_HEALTHY'),
    project('c', 'INACTIVE'),
  ];
  const lite = toLiteProjects(base);

  it('bloque si limite atteinte sans force', () => {
    const f = validateRestore(lite, 'c', { pauseFirst: [], force: false });
    expect(f?.code).toBe('limit-reached');
    expect(f?.assessment?.suggestions.length).toBeGreaterThan(0);
  });

  it('autorise avec force quand limite atteinte', () => {
    expect(
      validateRestore(lite, 'c', { pauseFirst: [], force: true })
    ).toBeNull();
  });

  it('autorise si pause préalable libère un slot', () => {
    expect(
      validateRestore(lite, 'c', { pauseFirst: ['a'], force: false })
    ).toBeNull();
  });
});

describe('pausesBeforeRestore', () => {
  it('ignore la cible et les projets déjà inactifs', () => {
    const projects = [
      project('a', 'ACTIVE_HEALTHY'),
      project('b', 'INACTIVE'),
      project('c', 'INACTIVE'),
    ];
    expect(pausesBeforeRestore(projects, ['a', 'b', 'c'], 'c')).toEqual(['a']);
  });
});

describe('assessRestore', () => {
  it('projette les pauses préalables', () => {
    const projects = toLiteProjects([
      project('a', 'ACTIVE_HEALTHY'),
      project('b', 'ACTIVE_HEALTHY'),
      project('c', 'INACTIVE'),
    ]);
    const a = assessRestore(projects, 'c', ['a']);
    expect(a.allowed).toBe(true);
    expect(a.reason).toBe('ok');
  });
});
