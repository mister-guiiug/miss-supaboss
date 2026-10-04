import { getQueryClient as getFamilyQueryClient } from '@mister-guiiug/dev-pwa-config/react/query-client';

/**
 * Client Query — defaults famille, avec refetch au focus (console ops :
 * une flotte qu'on revient voir doit être fraîche).
 */
export function getQueryClient() {
  return getFamilyQueryClient({
    queries: { refetchOnWindowFocus: true },
  });
}

export {
  resetQueryClient,
  createQueryClient,
} from '@mister-guiiug/dev-pwa-config/react/query-client';
