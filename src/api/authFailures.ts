/**
 * Compteur de 401 (PAT) sur la session courante — déclenche un toast + lien
 * doc après N échecs, sans persister (simple aide à la rotation).
 */
const THRESHOLD = 3;
let consecutive401 = 0;
let toastShown = false;

export const authFailures = {
  record(status: number): void {
    if (status === 401) {
      consecutive401 += 1;
    } else if (status > 0) {
      consecutive401 = 0;
      toastShown = false;
    }
  },

  shouldWarn(): boolean {
    return consecutive401 >= THRESHOLD && !toastShown;
  },

  markWarned(): void {
    toastShown = true;
  },

  reset(): void {
    consecutive401 = 0;
    toastShown = false;
  },

  count(): number {
    return consecutive401;
  },
};
