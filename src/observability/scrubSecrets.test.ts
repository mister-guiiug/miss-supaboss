import { describe, expect, it } from 'vitest';
import { scrubSecrets, scrubUnknown } from './scrubSecrets.ts';

describe('scrubSecrets', () => {
  it('masque un PAT et un Bearer', () => {
    expect(scrubSecrets('header Authorization: Bearer sbp_abc123xyz')).toBe(
      'header Authorization: Bearer [redacted]'
    );
    expect(scrubSecrets('token sbp_abc123xyz refusé')).toBe(
      'token sbp_[redacted] refusé'
    );
  });

  it('masque la clé authorization et les chaînes imbriquées', () => {
    expect(
      scrubUnknown({
        authorization: 'Bearer sbp_secret',
        message: 'échec sbp_secret',
        nested: { pat: 'sbp_secret' },
      })
    ).toEqual({
      authorization: '[redacted]',
      message: 'échec sbp_[redacted]',
      nested: { pat: '[redacted]' },
    });
  });
});
