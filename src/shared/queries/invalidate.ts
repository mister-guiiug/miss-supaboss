import { getQueryClient } from './client.ts';
import { queryKeys } from './keys.ts';

export function invalidateOperations(): void {
  void getQueryClient().invalidateQueries({ queryKey: ['operations'] });
}

export function invalidateFleet(): void {
  void getQueryClient().invalidateQueries({ queryKey: ['fleet'] });
}

export function invalidateSettings(): void {
  void getQueryClient().invalidateQueries({ queryKey: queryKeys.settings() });
}

/** Après une mutation flotte/compte : rafraîchir flotte + journal. */
export function invalidateAfterFleetMutation(): void {
  invalidateFleet();
  invalidateOperations();
}

export function invalidateAssessRestore(accountId: string, ref: string): void {
  void getQueryClient().invalidateQueries({
    queryKey: queryKeys.assessRestore(accountId, ref),
  });
}
