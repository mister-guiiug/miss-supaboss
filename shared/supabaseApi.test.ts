import { describe, expect, it } from 'vitest';
import { parseOrganizationProjectsPage, parseProjects } from './supabaseApi.ts';

describe('parseProjects', () => {
  it('accepte organization_slug', () => {
    expect(
      parseProjects([
        {
          ref: 'abcdefghijklmnopqrst',
          name: 'A',
          region: 'eu-west-3',
          organization_slug: 'acme',
          status: 'ACTIVE_HEALTHY',
          created_at: '2026-01-01T00:00:00Z',
        },
      ])
    ).toEqual([
      {
        ref: 'abcdefghijklmnopqrst',
        name: 'A',
        region: 'eu-west-3',
        organizationSlug: 'acme',
        status: 'ACTIVE_HEALTHY',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);
  });

  it('replie sur organization_id si organization_slug est absent', () => {
    const [project] = parseProjects([
      {
        ref: 'abcdefghijklmnopqrst',
        name: 'A',
        region: 'eu-west-3',
        organization_id: 'acme',
        status: 'INACTIVE',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(project?.organizationSlug).toBe('acme');
  });

  it('ignore une ligne sans aucune clé d organisation', () => {
    expect(
      parseProjects([
        {
          ref: 'abcdefghijklmnopqrst',
          name: 'A',
          region: 'eu-west-3',
          status: 'INACTIVE',
          created_at: '2026-01-01T00:00:00Z',
        },
      ])
    ).toEqual([]);
  });
});

describe('parseOrganizationProjectsPage', () => {
  it('rattache le slug d URL et mappe inserted_at → createdAt', () => {
    const page = parseOrganizationProjectsPage(
      {
        projects: [
          {
            ref: 'abcdefghijklmnopqrst',
            name: 'A',
            region: 'eu-west-3',
            status: 'PAUSING',
            inserted_at: '2026-02-01T00:00:00Z',
            is_branch: false,
          },
        ],
        pagination: { count: 1, limit: 100, offset: 0 },
      },
      'acme'
    );
    expect(page.total).toBe(1);
    expect(page.projects).toEqual([
      {
        ref: 'abcdefghijklmnopqrst',
        name: 'A',
        region: 'eu-west-3',
        organizationSlug: 'acme',
        status: 'PAUSING',
        createdAt: '2026-02-01T00:00:00Z',
      },
    ]);
  });
});
