import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/index.ts';
import { queryKeys } from '../queries/keys.ts';

/** Journal d'audit — cache partagé, invalidé après mutations flotte/comptes. */
export function useOperations(limit = 100) {
  return useQuery({
    queryKey: queryKeys.operations(limit),
    queryFn: () => api.listOperations(limit),
  });
}
