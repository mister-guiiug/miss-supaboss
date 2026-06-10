import type { Api } from './types.ts';
import { IS_MOCK } from './demoMode.ts';
import { createHttpApi } from './http.ts';
import { createMockApi } from '../mock/mockApi.ts';

/** Point d'accès unique : le reste de l'app ignore le mode mock. */
export const api: Api = IS_MOCK ? createMockApi() : createHttpApi();
export { ApiError } from './types.ts';
export {
  FORCED_MOCK,
  IS_MOCK,
  resetDemoData,
  setDemoMode,
  switchDemoMode,
} from './demoMode.ts';
