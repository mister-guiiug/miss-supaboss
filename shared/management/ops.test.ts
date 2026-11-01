import { describe, expect, it, vi } from 'vitest';
import { createManagementOps } from './ops.ts';

describe('createManagementOps', () => {
  it('listOrganizations parse la réponse', async () => {
    const request = vi.fn(async () => [{ id: '1', name: 'Org', slug: 'org' }]);
    const ops = createManagementOps(request);
    const orgs = await ops.listOrganizations();
    expect(request).toHaveBeenCalledWith('/v1/organizations');
    expect(orgs[0]?.slug).toBe('org');
  });

  it('pause POST /pause', async () => {
    const request = vi.fn(async () => ({}));
    await createManagementOps(request).pause('abcdefghijabcdefghij');
    expect(request).toHaveBeenCalledWith(
      `/v1/projects/${encodeURIComponent('abcdefghijabcdefghij')}/pause`,
      { method: 'POST', body: '{}' }
    );
  });

  it('listRestoreVersions → ok:false sur erreur bloquée', async () => {
    const err = Object.assign(new Error('gone'), { status: 410 });
    const request = vi.fn(async () => {
      throw err;
    });
    const result = await createManagementOps(request).listRestoreVersions(
      'abcdefghijabcdefghij'
    );
    expect(result).toEqual({ ok: false, versions: [] });
  });
});
