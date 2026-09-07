/**
 * Filtrage par rôle du tableau `/admin/users`.
 *
 * La vue par défaut ne montre que les **clients** : ce tableau sert à regarder
 * des comptes clients, et un admin qui s'y voit lui-même n'apprend rien. Le
 * compteur de la page les excluait déjà du total pour la même raison.
 *
 * Ils sortent de la **vue**, pas des **données** : choisir « Admin » dans le
 * filtre les ramène. Sans cette porte, plus aucun écran ne dirait qui détient
 * les droits d'administration — or `ADMIN_PHONE` / `ADMIN_EMAIL` promeuvent
 * silencieusement à la connexion, et c'est précisément ce qu'il faut pouvoir
 * vérifier.
 */

export type AdminUserRole = 'couple' | 'pro' | 'guest' | 'admin';

/** Valeur du filtre : un rôle précis, ou `all` pour la vue par défaut. */
export type RoleFilterValue = AdminUserRole | 'all';

export function matchesRoleFilter(role: AdminUserRole, filter: RoleFilterValue): boolean {
  if (filter === 'all') return role !== 'admin';
  return role === filter;
}
