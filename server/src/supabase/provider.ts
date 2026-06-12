/**
 * Interface « provider » Supabase : tout ce que le reste du serveur a le
 * droit de demander. Permet de brancher demain une autre source de métriques
 * (exigence spec) et fournit le mode mock sans toucher au métier.
 */
// Types bruts définis une seule fois dans le contrat partagé (réutilisés par
// le client navigateur local-first). Importés pour usage local ET re-exportés
// pour les consommateurs serveur existants.
import type {
  RawOrganization,
  RawProject,
} from '../../../shared/supabaseApi.ts';

export type { RawOrganization, RawProject };

/**
 * Mesures collectées pour UN projet. `null` = indisponible (jamais inventé).
 * - dbSizeBytes / storageBytes : mesurés via SQL (endpoint documenté) ;
 * - mau : ESTIMATION (connexions du mois via auth.users) ;
 * - egressBytes : aucun endpoint Management documenté → toujours null
 *   (TODO adaptateur, voir management.ts).
 */
export interface ProviderMetrics {
  dbSizeBytes: number | null;
  storageBytes: number | null;
  mau: number | null;
  egressBytes: number | null;
  measuredAt: string;
}

export interface SupabaseProvider {
  /** Vérifie le PAT et retourne les organisations accessibles. */
  listOrganizations(
    accountKey: string,
    pat: string
  ): Promise<RawOrganization[]>;
  listProjects(accountKey: string, pat: string): Promise<RawProject[]>;
  pauseProject(accountKey: string, pat: string, ref: string): Promise<void>;
  restoreProject(accountKey: string, pat: string, ref: string): Promise<void>;
  /** Le projet doit être actif (les requêtes SQL échouent sinon). */
  collectMetrics(
    accountKey: string,
    pat: string,
    ref: string
  ): Promise<ProviderMetrics>;
}
