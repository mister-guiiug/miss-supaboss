import type {
  AccountDto,
  FleetDto,
  FleetMetricsDto,
  OperationDto,
  ProjectDto,
  ProjectMetaDto,
  RestoreAssessmentDto,
  SettingsDto,
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
  login(email: string, password: string): Promise<UserDto>;
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
