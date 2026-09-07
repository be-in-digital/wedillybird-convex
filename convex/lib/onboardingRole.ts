/**
 * Rôle écrit en fin d'onboarding — **anti-rétrogradation**.
 *
 * L'onboarding sert à faire sortir un compte de `guest`. Il ne doit jamais
 * *abaisser* un rôle déjà attribué, parce que deux comptes légitimes arrivent
 * sur le wizard avec un rôle déjà posé mais sans `fullName` :
 *
 *  - un **admin plateforme** promu par `ADMIN_PHONE` / `ADMIN_EMAIL` à la
 *    première connexion : terminer l'onboarding le rétrogradait en couple/pro
 *    et lui faisait perdre `/admin` jusqu'à la connexion suivante ;
 *  - un **partenaire** qui a consommé son lien `/rejoindre/[token]` avant de
 *    remplir son profil : il est déjà `pro`, avec son organisation et son
 *    abonnement offert — choisir « couple » au wizard le décrochait de tout.
 *
 * D'où la règle : on ne garde que le **rôle le plus élevé** entre celui déjà
 * en base et celui choisi. La montée reste possible (`guest` → `couple`/`pro`,
 * `couple` → `pro`), la descente jamais.
 *
 * Fonction pure et sans dépendance Convex pour être testable directement.
 * ⚠️ Gardé en phase avec `lib/auth/onboarding-role.ts` (le bundler Convex ne
 * suit pas les imports applicatifs) — cf. `tests/unit/convex/onboarding-role.test.ts`.
 */

/** Rôles stockés sur `users.role`. */
export type StoredRole = 'guest' | 'couple' | 'pro' | 'admin';

/** Rôles proposés au wizard d'onboarding. */
export type ChosenRole = 'couple' | 'pro';

/** Hiérarchie des rôles : on ne descend jamais cette échelle via l'onboarding. */
const ROLE_RANK: Record<StoredRole, number> = {
  guest: 0,
  couple: 1,
  pro: 2,
  admin: 3,
};

/**
 * Un rôle est « établi » dès qu'il n'est plus `guest` : le wizard n'a alors
 * plus à poser la question, et l'aiguillage post-auth sait où envoyer l'user.
 */
export function isSettledRole(role: StoredRole | null | undefined): boolean {
  return role != null && role !== 'guest';
}

/**
 * Résout le rôle à écrire.
 *
 * @param current Rôle actuellement en base (`undefined` pour un compte neuf).
 * @param chosen  Rôle choisi au wizard (`undefined` si le step a été masqué).
 */
export function resolveOnboardingRole(
  current: StoredRole | null | undefined,
  chosen: ChosenRole | null | undefined,
): StoredRole {
  const base: StoredRole = current ?? 'guest';
  if (!chosen) return base;
  return ROLE_RANK[chosen] > ROLE_RANK[base] ? chosen : base;
}
