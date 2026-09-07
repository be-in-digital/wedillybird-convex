/**
 * Rétention de galerie par forfait — source unique côté Convex.
 *
 * Extrait de `convex/payments.ts` (où la règle était privée au module) pour que
 * l'octroi commercial d'un forfait (`admin:grantEventPlan`) produise EXACTEMENT
 * le même état qu'un paiement Stripe. Deux chemins qui écrivent `planTier` sans
 * partager le calcul de `galleryExpiresAt`, c'est la garantie d'une galerie qui
 * expire au mauvais moment sur les comptes offerts.
 *
 * Volontairement convex-local (le bundler Convex ne suit pas les imports
 * app-side) — le miroir app-side vit dans `lib/payments/reconcile.ts`.
 */

/** Rétention incluse par forfait, en jours après la date de l'event. */
export const GALLERY_RETENTION_DAYS: Record<'essential' | 'premium', number> = {
  essential: 30,
  premium: 180,
};

/** L'upsell HD post-event pousse la rétention à 5 ans. */
export const POST_EVENT_UPSELL_RETENTION_DAYS = 5 * 365;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Date d'expiration de la galerie pour un forfait donné. */
export function galleryExpiresAtFor(plan: 'essential' | 'premium', eventDate: number): number {
  return eventDate + GALLERY_RETENTION_DAYS[plan] * MS_PER_DAY;
}
