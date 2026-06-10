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
  ): Promise<{ ok: boolean; organizations: number; projects: number }>;
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
}

export const IS_MOCK = import.meta.env.VITE_MOCK === '1';
