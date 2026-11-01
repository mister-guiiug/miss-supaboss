import { describe, expect, it } from 'vitest';
import {
  openPortableAccounts,
  sealPortableAccounts,
} from './portableExport.ts';

const PASS = 'export-passphrase-ok';

describe('portableExport', () => {
  it('aller-retour des comptes', async () => {
    const blob = await sealPortableAccounts(
      [
        {
          alias: 'Lab',
          color: '#3ecf8e',
          pat: 'sbp_secret_token_01',
          patExpiresAt: null,
        },
      ],
      PASS
    );
    expect(blob.startsWith('msb1.')).toBe(true);
    const opened = await openPortableAccounts(blob, PASS);
    expect(opened).toEqual([
      {
        alias: 'Lab',
        color: '#3ecf8e',
        pat: 'sbp_secret_token_01',
        patExpiresAt: null,
      },
    ]);
  });

  it('refuse une mauvaise phrase', async () => {
    const blob = await sealPortableAccounts(
      [{ alias: 'A', color: '#000', pat: 'sbp_x', patExpiresAt: null }],
      PASS
    );
    await expect(
      openPortableAccounts(blob, 'wrong-passphrase!!')
    ).rejects.toThrow('passphrase');
  });
});
