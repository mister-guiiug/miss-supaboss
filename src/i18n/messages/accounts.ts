/** Domaine i18n « accounts » — fr + en. */
export const accountsFr = {
  accounts: {
    add: 'Ajouter un compte Supabase',
    emptyTitle: 'Aucun compte',
    emptyBody:
      'Ajoutez votre premier compte Supabase avec un PAT (Personal Access Token).',
    patLine: 'PAT {hint} · synchro {rel}',
    patExpiresLine: 'Expiration PAT rappelée : {date}',
    test: 'Tester',
    testing: 'Test…',
    retest: 'Retester',
    verifyProxy: 'Vérifier le proxy',
    proxyMissing: 'proxy non configuré',
    scopesDoc: 'Scopes PAT',
    patDoc: 'Régénérer un PAT',
    syncKind: {
      network: 'Réseau',
      pat: 'PAT',
      scope: 'Scopes',
      unknown: 'Erreur',
    },
    active: 'Actif',
    enableAria: 'Activer {alias}',
    renameAria: 'Renommer {alias}',
    deleteAria: 'Supprimer {alias}',
    testSuccess: '{alias} : {count} org{list} · {projects} projets',
    testError: 'Test impossible',
    updateError: 'Mise à jour impossible',
    deleted: 'Compte « {alias} » supprimé',
    deleteError: 'Suppression impossible',
    deleteTitle: 'Supprimer « {alias} » ?',
    deleteBody:
      "Le PAT chiffré, les tags et l'historique de méta de ce compte seront supprimés de Miss Supaboss. Les projets Supabase eux-mêmes ne sont PAS touchés.",
    form: {
      editTitle: 'Modifier le compte',
      testAndAdd: 'Tester et ajouter',
      blockedInDemo: 'Indisponible en démo',
      demoWarning:
        'Mode démo : un PAT réel produirait des projets fictifs. Passez en réel d’abord.',
      demoBlocked:
        'Ajout de PAT bloqué en mode démo — basculez en réel pour connecter votre flotte.',
      demoForced:
        'Ce build est en démo seule (pas de proxy). Impossible d’ajouter un vrai PAT ici.',
      switchToReal: 'Voir mes comptes',
      aliasLabel: 'Alias lisible',
      aliasPlaceholder: 'Ex. Lab POC interne',
      patLabel: 'Personal Access Token (sbp_…)',
      patHint:
        'Créé sur supabase.com → Account → Access Tokens. Stocké chiffré (AES-256-GCM) côté serveur, jamais dans ce navigateur.',
      patHintLocal:
        'Créé sur supabase.com → Account → Access Tokens. Gardé dans ce navigateur (coffre recommandé) ; les appels passent par un relais qui ne le conserve pas.',
      patScopes:
        'Scopes minimaux : lecture organisations + projets (organization_projects_read / projects_read). Pause/restore et health exigent project_admin. Fine-grained trop étroit → 403 « élargir le PAT ».',
      scopePresetLegend: 'Intention des scopes',
      scopeRead: 'Lecture seule',
      scopeAdmin: 'Admin pause/restore',
      scopeReadHint:
        'Inventaire et quotas : organization_projects_read + projects_read. Pas de pause/restore.',
      scopeAdminHint:
        'Lecture + project_admin pour pause, restore et health. Moins privilégié que le PAT « full ».',
      more: 'Scopes et expiration (optionnel)',
      patExpiresLabel: 'Expiration du PAT (rappel local, optionnel)',
      patExpiresHint:
        'Aide-mémoire uniquement — Supabase ne l’expose pas à l’API. Après plusieurs 401, régénérez le jeton.',
      vaultEnable: 'Activer le coffre (recommandé)',
      vaultRecommended:
        'Phrase secrète (min. 12, pas trop faible) : chiffre le PAT sur cet appareil (AES-256-GCM).',
      vaultBrowserStore:
        'Par défaut, la phrase est proposée au gestionnaire de mots de passe du navigateur (Credential Management).',
      vaultSkipped:
        'Sans coffre, le PAT est stocké en clair dans ce navigateur (localStorage). Toute extension ou personne avec accès à cet appareil peut le lire.',
      colorAria: 'Couleur du compte',
      colorSwatchAria: 'Couleur {color}',
      invalid: 'Saisie invalide',
      updateFail: 'Modification impossible',
      addFail: 'Ajout impossible',
      updated: 'Compte « {alias} » modifié',
      added: 'Compte « {alias} » ajouté et vérifié',
    },
  },
} as const;

export const accountsEn = {
  accounts: {
    add: 'Add a Supabase account',
    emptyTitle: 'No account',
    emptyBody:
      'Add your first Supabase account with a PAT (Personal Access Token).',
    patLine: 'PAT {hint} · synced {rel}',
    patExpiresLine: 'PAT expiry reminder: {date}',
    test: 'Test',
    testing: 'Testing…',
    retest: 'Retest',
    verifyProxy: 'Check proxy',
    proxyMissing: 'proxy not configured',
    scopesDoc: 'PAT scopes',
    patDoc: 'Regenerate a PAT',
    syncKind: {
      network: 'Network',
      pat: 'PAT',
      scope: 'Scopes',
      unknown: 'Error',
    },
    active: 'Active',
    enableAria: 'Enable {alias}',
    renameAria: 'Rename {alias}',
    deleteAria: 'Delete {alias}',
    testSuccess: '{alias}: {count} org{list} · {projects} projects',
    testError: 'Test failed',
    updateError: 'Update failed',
    deleted: 'Account “{alias}” deleted',
    deleteError: 'Deletion failed',
    deleteTitle: 'Delete “{alias}”?',
    deleteBody:
      'This account’s encrypted PAT, tags and meta history will be removed from Miss Supaboss. The Supabase projects themselves are NOT touched.',
    form: {
      editTitle: 'Edit account',
      testAndAdd: 'Test and add',
      blockedInDemo: 'Unavailable in demo',
      demoWarning:
        'Demo mode: a real PAT would create fake projects. Switch to real first.',
      demoBlocked:
        'PAT add blocked in demo mode — switch to real to connect your fleet.',
      demoForced:
        'This build is demo-only (no proxy). Cannot add a real PAT here.',
      switchToReal: 'See my accounts',
      aliasLabel: 'Readable alias',
      aliasPlaceholder: 'e.g. Internal POC lab',
      patLabel: 'Personal Access Token (sbp_…)',
      patHint:
        'Created on supabase.com → Account → Access Tokens. Stored encrypted (AES-256-GCM) server-side, never in this browser.',
      patHintLocal:
        'Created on supabase.com → Account → Access Tokens. Kept in this browser (vault recommended); calls go through a relay that does not store it.',
      patScopes:
        'Minimum scopes: organizations + projects read (organization_projects_read / projects_read). Pause/restore and health need project_admin. Too-narrow fine-grained → 403 “widen the PAT”.',
      scopePresetLegend: 'Scope intent',
      scopeRead: 'Read-only',
      scopeAdmin: 'Admin pause/restore',
      scopeReadHint:
        'Inventory and quotas: organization_projects_read + projects_read. No pause/restore.',
      scopeAdminHint:
        'Read + project_admin for pause, restore and health. Less privileged than a full PAT.',
      more: 'Scopes and expiry (optional)',
      patExpiresLabel: 'PAT expiry (local reminder, optional)',
      patExpiresHint:
        'Reminder only — Supabase does not expose this via API. After repeated 401s, regenerate the token.',
      vaultEnable: 'Enable the vault (recommended)',
      vaultRecommended:
        'Passphrase (min. 12, not too weak): encrypts the PAT on this device (AES-256-GCM).',
      vaultBrowserStore:
        'By default, the passphrase is offered to the browser password manager (Credential Management).',
      vaultSkipped:
        'Without a vault, the PAT is stored in plaintext in this browser (localStorage). Any extension or person with access to this device can read it.',
      colorAria: 'Account color',
      colorSwatchAria: 'Color {color}',
      invalid: 'Invalid input',
      updateFail: 'Update failed',
      addFail: 'Add failed',
      updated: 'Account “{alias}” updated',
      added: 'Account “{alias}” added and verified',
    },
  },
} as const;
