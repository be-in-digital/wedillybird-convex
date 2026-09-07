/**
 * Nom d'un coupon Stripe — la contrainte qui casse tout en silence.
 *
 * `coupon.name` est plafonné à **40 caractères** côté Stripe, et un
 * dépassement n'est pas une troncature polie : c'est un `400 Invalid string:
 * …; must be at most 40 characters` qui fait échouer la création entière.
 *
 * Deux endroits s'y sont cognés :
 *
 *  - le coupon partenaire, dont le nom concaténait le nom d'affichage ET le
 *    code (`« Partenaire Sarah - Your Wedding Method — SARAH12 (-10 %) »`,
 *    56 car.) → l'affilié était créé sans code partageable ;
 *  - le libellé du coupon de checkout cumulant crédit de parrainage et remise
 *    partenaire (52 car.) → l'exception était avalée par le `catch` de
 *    `app/api/checkout/route.ts` et l'acheteur perdait sa remise SANS erreur.
 *
 * Toute chaîne envoyée en `name` passe donc par `clampCouponName`, et les
 * constructeurs de noms se budgètent avec `couponNameLength`.
 */

/** Limite Stripe sur `coupon.name` (caractères, pas octets). */
export const STRIPE_COUPON_NAME_MAX_LENGTH = 40;

const ELLIPSIS = '…';

/**
 * Longueur en caractères au sens Stripe.
 *
 * `String.length` compte les unités UTF-16 (2 pour un emoji) : un nom
 * d'affichage avec émoji passerait le test local et se ferait refuser par
 * Stripe. On compte donc les points de code.
 */
export function couponNameLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Coupe `value` à `max` caractères **ellipse comprise**, pour que personne ne
 * lise un nom tronqué comme un nom complet.
 */
export function truncateCouponSegment(value: string, max: number): string {
  if (max <= 0) return '';
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  if (max === 1) return ELLIPSIS;
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}${ELLIPSIS}`;
}

/**
 * Dernier rempart avant l'appel Stripe : garantit un nom acceptable.
 *
 * Les constructeurs de noms (coupon partenaire, libellés de checkout) tiennent
 * déjà dans le budget ; ce garde-fou couvre le reste — dont le champ « Nom
 * interne » libre du back-office promotions, où un nom trop long ferait perdre
 * le coupon plutôt que de simplement le renommer.
 */
export function clampCouponName(name: string): string {
  return truncateCouponSegment(name, STRIPE_COUPON_NAME_MAX_LENGTH);
}
