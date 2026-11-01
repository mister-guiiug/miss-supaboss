import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VAULT_CREDENTIAL_ID,
  canStoreVaultPassphrase,
  loadVaultPassphrase,
  storeVaultPassphrase,
} from './browserCredentials.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browserCredentials — piste A', () => {
  it('canStoreVaultPassphrase : false sans PasswordCredential', () => {
    vi.stubGlobal('navigator', { credentials: { store: vi.fn() } });
    expect(canStoreVaultPassphrase()).toBe(false);
  });

  it('storeVaultPassphrase enregistre via PasswordCredential', async () => {
    const store = vi.fn(async () => undefined);
    class FakePasswordCredential {
      id: string;
      password: string;
      name?: string;
      constructor(data: { id: string; password: string; name?: string }) {
        this.id = data.id;
        this.password = data.password;
        this.name = data.name;
      }
    }
    vi.stubGlobal('PasswordCredential', FakePasswordCredential);
    vi.stubGlobal('navigator', { credentials: { store } });
    expect(canStoreVaultPassphrase()).toBe(true);
    expect(await storeVaultPassphrase('phrase-solide-xyz')).toBe(true);
    expect(store).toHaveBeenCalledOnce();
    const [cred] = store.mock.calls[0] as unknown as [FakePasswordCredential];
    expect(cred.id).toBe(VAULT_CREDENTIAL_ID);
    expect(cred.password).toBe('phrase-solide-xyz');
  });

  it('loadVaultPassphrase lit une entrée Miss Supaboss', async () => {
    const get = vi.fn(async () => ({
      id: VAULT_CREDENTIAL_ID,
      password: 'from-manager',
    }));
    vi.stubGlobal('navigator', { credentials: { get } });
    expect(await loadVaultPassphrase()).toBe('from-manager');
  });

  it('loadVaultPassphrase ignore un autre id', async () => {
    vi.stubGlobal('navigator', {
      credentials: {
        get: vi.fn(async () => ({ id: 'autre@site', password: 'x' })),
      },
    });
    expect(await loadVaultPassphrase()).toBeNull();
  });
});
