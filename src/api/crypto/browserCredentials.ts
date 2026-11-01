/**
 * Piste A — Credential Management API : stocker / relire la phrase du coffre
 * via le gestionnaire de mots de passe du navigateur (Chrome / Edge surtout).
 * Échec silencieux si l’API est absente ou refusée — la saisie manuelle reste.
 */
export const VAULT_CREDENTIAL_ID = 'miss-supaboss-vault';

type PasswordCredLike = Credential & {
  id: string;
  password?: string;
};

function PasswordCredentialCtor():
  | (new (data: { id: string; password: string; name?: string }) => Credential)
  | null {
  const ctor = (
    globalThis as unknown as {
      PasswordCredential?: new (data: {
        id: string;
        password: string;
        name?: string;
      }) => Credential;
    }
  ).PasswordCredential;
  return typeof ctor === 'function' ? ctor : null;
}

/** Navigateur capable de `navigator.credentials.store` + PasswordCredential. */
export function canStoreVaultPassphrase(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials?.store === 'function' &&
    PasswordCredentialCtor() !== null
  );
}

/** Enregistre la phrase du coffre dans le gestionnaire du navigateur. */
export async function storeVaultPassphrase(
  passphrase: string
): Promise<boolean> {
  const Ctor = PasswordCredentialCtor();
  if (!Ctor || typeof navigator.credentials?.store !== 'function') return false;
  try {
    const cred = new Ctor({
      id: VAULT_CREDENTIAL_ID,
      name: 'Miss Supaboss',
      password: passphrase,
    });
    await navigator.credentials.store(cred);
    return true;
  } catch {
    return false;
  }
}

/**
 * Propose une phrase déjà connue du gestionnaire (mediation optional).
 * Ne force pas d’UI bloquante : si rien n’est proposé, retourne null.
 */
export async function loadVaultPassphrase(): Promise<string | null> {
  if (typeof navigator.credentials?.get !== 'function') return null;
  try {
    const cred = (await navigator.credentials.get({
      password: true,
      mediation: 'optional',
    } as CredentialRequestOptions)) as PasswordCredLike | null;
    if (
      !cred ||
      typeof cred.password !== 'string' ||
      cred.password.length === 0
    )
      return null;
    // Accepte l’id fixe Miss Supaboss, ou tout login pour cette origine
    // (certains gestionnaires réécrivent l’id).
    if (
      cred.id &&
      cred.id !== VAULT_CREDENTIAL_ID &&
      !cred.id.includes('supaboss')
    )
      return null;
    return cred.password;
  } catch {
    return null;
  }
}
