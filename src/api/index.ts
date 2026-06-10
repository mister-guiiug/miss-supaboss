import { IS_MOCK, type Api } from './types.ts';
import { createHttpApi } from './http.ts';
import { createMockApi } from '../mock/mockApi.ts';

/** Point d'accès unique : le reste de l'app ignore le mode mock. */
export const api: Api = IS_MOCK ? createMockApi() : createHttpApi();
export { ApiError, IS_MOCK } from './types.ts';
