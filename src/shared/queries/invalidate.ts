import { getQueryClient } from './client.ts';

function invalidateOperations(): void {
  void getQueryClient().invalidateQueries({ queryKey: ['operations'] });
}

function invalidateFleet(): void {
  void getQueryClient().invalidateQueries({ queryKey: ['fleet'] });
}

/** Après une mutation flotte/compte : rafraîchir flotte + journal. */
export function invalidateAfterFleetMutation(): void {
  invalidateFleet();
  invalidateOperations();
}
