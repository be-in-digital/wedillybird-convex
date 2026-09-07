/**
 * Compte offert — helpers côté app.
 *
 * **Miroir** de `convex/lib/partnerInvite.ts` (source de vérité serveur). Le
 * bundler Convex ne suit pas les imports de `lib/`, d'où la duplication ; un
 * test croise les deux implémentations pour qu'elles ne dérivent pas.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Le cadeau court-il encore ? Strictement `expiresAt > now`. */
export function isCompActive(
  comp: { expiresAt: number } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!comp) return false;
  return comp.expiresAt > now;
}

/**
 * Jours entiers restants, arrondis vers le haut — « il reste 1 jour » tant
 * qu'il reste quelques heures, jamais « 0 jour » sur un compte encore ouvert.
 */
export function compDaysRemaining(
  comp: { expiresAt: number } | null | undefined,
  now: number = Date.now(),
): number {
  if (!comp) return 0;
  const remaining = comp.expiresAt - now;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / MS_PER_DAY);
}
