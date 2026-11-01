/** Domaine i18n « auth » — fr + en. */
export const authFr = {
  login: {
    subtitle: 'Pilotage multi-comptes Supabase Free',
    email: 'E-mail',
    password: 'Mot de passe',
    signIn: 'Se connecter',
    signingIn: 'Connexion…',
    invalidCreds: 'Identifiants invalides',
    connectFail: 'Connexion impossible (serveur joignable ?)',
    initialAccount:
      'Compte initial : voir la console serveur au premier démarrage.',
    guideLink: 'Guide : quand un projet Supabase Free se met en pause',
    tryDemo: 'Essayer en mode démo (données fictives, sans compte)',
    totpTitle: 'Vérification en deux étapes',
    totpBack: 'Revenir au mot de passe',
    totpInvalid: 'Code invalide ou déjà utilisé.',
    totpExpired: 'Étape expirée : saisissez à nouveau votre mot de passe.',
    tooManyAttempts: 'Trop d’essais : patientez une minute.',
  },
  unlock: {
    title: 'Coffre verrouillé',
    body: 'Saisissez votre phrase secrète pour déchiffrer les PAT stockés sur cet appareil.',
    browserHint:
      'Si le navigateur propose une phrase enregistrée, elle est essayée automatiquement.',
    passphrase: 'Phrase secrète',
    wrong: 'Phrase incorrecte.',
    unlock: 'Déverrouiller',
    unlocking: 'Déverrouillage…',
    lockout: 'Trop d’essais — réessayez dans {seconds} s.',
    resetTitle: 'Effacer le coffre de cet appareil ?',
    resetWarning:
      'Réinitialiser efface définitivement les comptes chiffrés de cet appareil. Les PAT restent régénérables sur Supabase.',
    resetStep1: 'Les comptes et PAT chiffrés de CE navigateur sont effacés.',
    resetStep2: 'Régénérez un PAT sur supabase.com (Account → Access Tokens).',
    resetStep3: 'Revenez ici, activez le coffre, puis ajoutez le nouveau PAT.',
    reset: 'Tout effacer',
    forgot: 'Phrase oubliée ?',
    resetDone: 'Coffre réinitialisé.',
  },
  totp: {
    aria: 'Double authentification',
    heading: 'Sécurité — Double authentification (TOTP)',
    serverOnly:
      'La double authentification protège la connexion au serveur Miss Supaboss : sans objet ici, où il n’y a pas de connexion.',
    loadFail: 'État de la double authentification indisponible.',
    off: 'Inactive : le mot de passe suffit pour se connecter.',
    intro:
      'Ajoutez un code à 6 chiffres, renouvelé toutes les 30 secondes par une application d’authentification (Aegis, 2FAS, Google Authenticator…).',
    enable: 'Activer la double authentification',
    scan: 'Scannez ce QR code avec l’application, ou recopiez la clé.',
    qrAlt: 'QR code de configuration pour l’application d’authentification',
    qrFail: 'QR code indisponible : recopiez la clé à la main.',
    keyLabel: 'Clé à recopier',
    copyKey: 'Copier la clé',
    copied: 'Copié dans le presse-papier',
    copyFail: 'Copie impossible : sélectionnez le texte à la main.',
    codeLabel: 'Code affiché par l’application',
    confirm: 'Confirmer et activer',
    cancel: 'Annuler',
    invalidCode: 'Saisissez les 6 chiffres affichés par l’application.',
    enabledNotice: 'Double authentification activée.',
    recoveryTitle: 'Codes de secours',
    recoveryIntro:
      'Chacun ouvre UNE connexion si le téléphone manque. Ils ne seront plus jamais affichés : rangez-les en lieu sûr.',
    copyCodes: 'Copier les codes',
    recoveryDone: 'J’ai rangé mes codes',
    on: 'Active — {count} code(s) de secours restant(s).',
    lowCodes:
      'Il reste peu de codes de secours : désactivez puis réactivez pour en obtenir dix nouveaux.',
    disableIntro:
      'La désactiver exige votre mot de passe et un code (de l’application ou de secours).',
    password: 'Mot de passe',
    disableCode: 'Code (application ou secours)',
    disable: 'Désactiver la double authentification',
    disabledNotice: 'Double authentification désactivée.',
    failed: 'Opération impossible.',
  },
  authFailures: {
    toast:
      'Plusieurs refus 401 — le PAT est peut-être expiré. Régénérez-le sur Supabase.',
  },
  offline: {
    title: 'Connexion perdue',
    body: "Impossible de joindre le serveur Miss Supaboss et aucun état précédent n'est en cache sur cet appareil. Les actions pause / restauration ne sont jamais exécutées hors ligne.",
  },
  onboarding: {
    welcome: 'Bienvenue dans Miss Supaboss',
    step1: {
      pre: 'Sur',
      mid: '→ Account → Access Tokens, créez un',
      post: 'par compte gratuit (scopes orgs + projects).',
    },
    step2:
      'Choisissez le mode réel (pas la démo), activez le coffre, puis ajoutez le PAT — un résumé orgs/projets confirme avant commit.',
    step3:
      'Visualisez les projets actifs/en pause par organisation, les quotas Free Plan, et préparez vos démos en un geste.',
    localStep1:
      'Restez en mode réel (pas la démo) — le basculement est proposé si besoin.',
    localStep2:
      'Créez une phrase secrète (coffre recommandé, min. 12) : elle chiffre les PAT sur CET appareil. Vous pouvez l’ignorer — le PAT restera alors en clair.',
    localStep3:
      'Créez un PAT sur supabase.com (scopes lecture, ou admin pour pause/restore), collez-le : Miss Supaboss sonde les orgs avant d’enregistrer.',
    addFirst: 'Ajouter mon premier compte',
    askAdmin: "Demandez à un admin d'ajouter le premier compte.",
    security: {
      demo: "Mode démo : comptes et données simulés. Rien n'est envoyé à Supabase.",
      localFirst:
        'Mode local-first : le PAT reste sur CET appareil (coffre recommandé) et n’est transmis qu’au proxy de relais, en HTTPS. Export/import chiffré pour un autre appareil — pas de BDD cloud.',
      server:
        "Les PAT sont chiffrés (AES-256-GCM) côté serveur et n'atteignent jamais ce navigateur. Chaque action est journalisée.",
    },
  },
} as const;

export const authEn = {
  login: {
    subtitle: 'Multi-account Supabase Free control',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    invalidCreds: 'Invalid credentials',
    connectFail: 'Sign-in failed (is the server reachable?)',
    initialAccount: 'Initial account: see the server console on first start.',
    guideLink: 'Guide: when a Supabase Free project gets paused',
    tryDemo: 'Try demo mode (fake data, no account)',
    totpTitle: 'Two-step verification',
    totpBack: 'Back to password',
    totpInvalid: 'Invalid or already used code.',
    totpExpired: 'Step expired: enter your password again.',
    tooManyAttempts: 'Too many attempts: wait a minute.',
  },
  unlock: {
    title: 'Vault locked',
    body: 'Enter your passphrase to decrypt the PATs stored on this device.',
    browserHint:
      'If the browser offers a saved passphrase, it is tried automatically.',
    passphrase: 'Passphrase',
    wrong: 'Wrong passphrase.',
    unlock: 'Unlock',
    unlocking: 'Unlocking…',
    lockout: 'Too many attempts — try again in {seconds} s.',
    resetTitle: 'Erase the vault on this device?',
    resetWarning:
      'Resetting permanently erases the encrypted accounts on this device. PATs can still be regenerated on Supabase.',
    resetStep1: 'Encrypted accounts and PATs on THIS browser are wiped.',
    resetStep2: 'Regenerate a PAT on supabase.com (Account → Access Tokens).',
    resetStep3: 'Come back, enable the vault, then add the new PAT.',
    reset: 'Erase everything',
    forgot: 'Forgot passphrase?',
    resetDone: 'Vault reset.',
  },
  totp: {
    aria: 'Two-factor authentication',
    heading: 'Security — Two-factor authentication (TOTP)',
    serverOnly:
      'Two-factor authentication protects sign-in to the Miss Supaboss server: not applicable here, where there is no sign-in.',
    loadFail: 'Two-factor authentication status unavailable.',
    off: 'Off: the password alone signs you in.',
    intro:
      'Add a 6-digit code, renewed every 30 seconds by an authenticator app (Aegis, 2FAS, Google Authenticator…).',
    enable: 'Enable two-factor authentication',
    scan: 'Scan this QR code with the app, or type the key.',
    qrAlt: 'Setup QR code for the authenticator app',
    qrFail: 'QR code unavailable: type the key by hand.',
    keyLabel: 'Key to type',
    copyKey: 'Copy the key',
    copied: 'Copied to clipboard',
    copyFail: 'Copy failed: select the text by hand.',
    codeLabel: 'Code shown by the app',
    confirm: 'Confirm and enable',
    cancel: 'Cancel',
    invalidCode: 'Enter the 6 digits shown by the app.',
    enabledNotice: 'Two-factor authentication enabled.',
    recoveryTitle: 'Recovery codes',
    recoveryIntro:
      'Each one opens ONE sign-in if the phone is missing. They will never be shown again: store them somewhere safe.',
    copyCodes: 'Copy the codes',
    recoveryDone: 'I stored my codes',
    on: 'On — {count} recovery code(s) left.',
    lowCodes:
      'Few recovery codes left: disable then re-enable to get ten new ones.',
    disableIntro:
      'Disabling it requires your password and a code (from the app or a recovery code).',
    password: 'Password',
    disableCode: 'Code (app or recovery)',
    disable: 'Disable two-factor authentication',
    disabledNotice: 'Two-factor authentication disabled.',
    failed: 'Operation failed.',
  },
  authFailures: {
    toast:
      'Several 401 refusals — the PAT may be expired. Regenerate it on Supabase.',
  },
  offline: {
    title: 'Connection lost',
    body: 'Cannot reach the Miss Supaboss server and no previous state is cached on this device. Pause / restore actions are never run offline.',
  },
  onboarding: {
    welcome: 'Welcome to Miss Supaboss',
    step1: {
      pre: 'On',
      mid: '→ Account → Access Tokens, create a',
      post: 'per free account (orgs + projects scopes).',
    },
    step2:
      'Pick real mode (not demo), enable the vault, then add the PAT — an orgs/projects summary confirms before commit.',
    step3:
      'View active/paused projects by organization, Free Plan quotas, and prepare your demos in one gesture.',
    localStep1:
      'Stay in real mode (not demo) — switching is offered when needed.',
    localStep2:
      'Create a passphrase (recommended vault, min. 12): it encrypts PATs on THIS device. You can skip it — the PAT then stays in plaintext.',
    localStep3:
      'Create a PAT on supabase.com (read scopes, or admin for pause/restore), paste it: Miss Supaboss probes orgs before saving.',
    addFirst: 'Add my first account',
    askAdmin: 'Ask an admin to add the first account.',
    security: {
      demo: 'Demo mode: simulated accounts and data. Nothing is sent to Supabase.',
      localFirst:
        'Local-first mode: the PAT stays on THIS device (recommended vault) and is only forwarded to the relay proxy, over HTTPS. Encrypted export/import for another device — no cloud DB.',
      server:
        'PATs are encrypted (AES-256-GCM) server-side and never reach this browser. Every action is logged.',
    },
  },
} as const;
