import type {
  AccountDto,
  DeliveryReportDto,
  FleetDto,
  FleetMetricsDto,
  LoginResponseDto,
  LoginTotpBody,
  NotificationSettingsDto,
  OperationDto,
  ProjectDto,
  ProjectMetaDto,
  RestoreAssessmentDto,
  ScheduleCreateBody,
  ScheduleDto,
  SettingsDto,
  TotpEnrollmentDto,
  TotpStatusDto,
  UserDto,
} from '../../shared/contracts.ts';

/** Erreur API normalisée — `assessment` présent sur les 409 de garde-fou. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly assessment?: RestoreAssessmentDto;

  constructor(
    status: number,
    code: string,
    message: string,
    assessment?: RestoreAssessmentDto
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (assessment) this.assessment = assessment;
  }
}

export interface Api {
  /**
   * Avec la double authentification active, un mot de passe juste rend
   * `{ totpRequired: true }` et AUCUNE session : il faut `loginSecondFactor`.
   */
  login(email: string, password: string): Promise<LoginResponseDto>;
  /** Seconde étape : un code de l'application ou un code de secours. */
  loginSecondFactor(factor: LoginTotpBody): Promise<UserDto>;
  logout(): Promise<void>;
  me(): Promise<UserDto>;

  listAccounts(): Promise<AccountDto[]>;
  createAccount(input: {
    alias: string;
    pat: string;
    color: string;
  }): Promise<AccountDto>;
  updateAccount(
    id: string,
    fields: Partial<{
      alias: string;
      enabled: boolean;
      color: string;
      pat: string;
    }>
  ): Promise<AccountDto>;
  deleteAccount(id: string): Promise<void>;
  testAccount(
    id: string
  ): Promise<{ ok: boolean; organizations: string[]; projects: number }>;
  exportAccounts(passphrase: string): Promise<{ blob: string; count: number }>;
  importAccounts(
    passphrase: string,
    blob: string
  ): Promise<{ imported: number; total: number }>;

  getFleet(refresh: boolean): Promise<FleetDto>;
  getFleetMetrics(refresh: boolean): Promise<FleetMetricsDto>;
  getProject(
    accountId: string,
    ref: string,
    refresh: boolean
  ): Promise<ProjectDto>;
  assessRestore(accountId: string, ref: string): Promise<RestoreAssessmentDto>;
  pauseProject(accountId: string, ref: string): Promise<void>;
  restoreProject(
    accountId: string,
    ref: string,
    options: { pauseFirst: string[]; force: boolean }
  ): Promise<void>;
  updateProjectMeta(
    accountId: string,
    ref: string,
    fields: Partial<
      Pick<ProjectMetaDto, 'tags' | 'favorite' | 'demoFrequent' | 'notes'>
    >
  ): Promise<void>;

  listOperations(limit?: number): Promise<OperationDto[]>;
  getSettings(): Promise<SettingsDto>;
  putSettings(settings: SettingsDto): Promise<SettingsDto>;

  /**
   * Coffre de chiffrement des PAT au repos — présent UNIQUEMENT en mode
   * local-first (opt-in). Absent pour les backends mock/serveur (le serveur
   * chiffre déjà les PAT côté base).
   */
  vault?: VaultController;

  /**
   * Double authentification — le SERVEUR seulement : la démo et le mode
   * local-first n'ont pas de connexion à protéger.
   */
  totp?: TotpController;

  /**
   * Plannings de pause / restauration. Le serveur les exécute ; la démo les
   * conserve sur l'appareil sans jamais les exécuter ; le mode local-first
   * n'en a pas (rien ne tourne quand l'onglet est fermé).
   */
  schedules?: SchedulesController;

  /**
   * Notifications (Web Push, webhook). Le serveur envoie ; la démo ne montre
   * que les réglages. Absent en local-first.
   */
  notifications?: NotificationsController;
}

export interface TotpController {
  status(): Promise<TotpStatusDto>;
  /** Engendre un secret EN ATTENTE ; rien n'est actif avant `activate`. */
  enroll(): Promise<TotpEnrollmentDto>;
  /** Confirme par un premier code ; rend les codes de secours (une fois). */
  activate(code: string): Promise<string[]>;
  /** Exige le mot de passe et un code (application ou secours). */
  disable(password: string, code: string): Promise<void>;
}

export interface SchedulesController {
  /** Faux dans la démo : les plannings y sont gardés, jamais exécutés. */
  readonly runsInBackground: boolean;
  list(accountId: string, ref: string): Promise<ScheduleDto[]>;
  create(
    accountId: string,
    ref: string,
    body: ScheduleCreateBody
  ): Promise<ScheduleDto>;
  remove(accountId: string, ref: string, id: string): Promise<void>;
}

export interface NotificationsController {
  /** Faux dans la démo : réglages visibles, aucun envoi possible. */
  readonly canSend: boolean;
  /**
   * Route que le transport HTTP du socle appelle pour (dés)abonner CE
   * navigateur au Web Push ; null sans serveur.
   */
  readonly pushSubscriptionsUrl: string | null;
  settings(): Promise<NotificationSettingsDto>;
  /** URL https du webhook, ou null pour le retirer. */
  setWebhook(url: string | null): Promise<NotificationSettingsDto>;
  sendTest(): Promise<DeliveryReportDto>;
}

/** Contrôle du chiffrement au repos des PAT (mode local-first). */
export interface VaultController {
  /** Le chiffrement est-il activé sur cet appareil ? */
  isEnabled(): boolean;
  /** Le coffre est-il déverrouillé pour cette session ? */
  isUnlocked(): boolean;
  /** Active le chiffrement avec une nouvelle phrase et chiffre les PAT existants. */
  enable(passphrase: string): Promise<void>;
  /** Désactive le chiffrement (nécessite d'être déverrouillé) : PAT remis en clair. */
  disable(): Promise<void>;
  /** Déverrouille et déchiffre les PAT en mémoire. false si phrase incorrecte. */
  unlock(passphrase: string): Promise<boolean>;
  /** Oublie la clé en mémoire (re-déverrouillage requis). */
  lock(): void;
  /** Phrase oubliée : efface le coffre ET les comptes chiffrés (irrécupérables). */
  reset(): void;
}
