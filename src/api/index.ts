import type { Api } from './types.ts';
import { IS_MOCK, PROXY_BASE } from './demoMode.ts';
import { createHttpApi } from './http.ts';
import { createLocalRealApi } from './localRealApi.ts';
import { createMockApi } from '../mock/mockApi.ts';

/**
 * Point d'accès unique. Trois implémentations :
 * - démo (mock) ;
 * - réel local-first via le proxy CORS (build PWA + VITE_SUPABASE_PROXY) ;
 * - réel via le backend Fastify même origine (build auto-hébergé).
 * IS_MOCK garantit déjà qu'on ne passe en « réel » que s'il est atteignable.
 */
export const api: Api = IS_MOCK
  ? createMockApi()
  : PROXY_BASE
    ? createLocalRealApi(PROXY_BASE)
    : createHttpApi();
export { ApiError } from './types.ts';
export {
  FORCED_MOCK,
  IS_MOCK,
  PROXY_BASE,
  REAL_AVAILABLE,
  isDemoSeed,
  resetDemoData,
  setDemoMode,
  setDemoSeed,
  switchDemoMode,
} from './demoMode.ts';
