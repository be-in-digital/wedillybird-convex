/**
 * Coupon partenaire — le code que la créatrice partage à sa communauté.
 *
 * Deux surfaces d'attribution coexistent, et c'est voulu :
 *
 *  - le **lien** `?ref=CODE` pose le cookie `wdb_ref` (attribution silencieuse,
 *    zéro friction, remise appliquée automatiquement au checkout) ;
 *  - le **code** tapé au checkout, pour l'audience qui voit « -10 % avec SARAH »
 *    en story sans jamais cliquer de lien.
 *
 * Pour que les deux mènent au même endroit, le code promo Stripe porte
 * EXACTEMENT la même chaîne que `affiliates.code` : `markSucceeded` remonte du
 * code promo vers l'affilié (`findActiveAffiliateByCode`) et crédite la même
 * commission que le lien aurait créditée.
 *
 * Ce module ne contient que la logique PURE (paramètres du coupon, garde-fous).
 * Les appels Stripe vivent dans les server actions admin.
 */

/**
 * Durée de validité d'un code partenaire. Un an : assez long pour une
 * collaboration qui s'installe, assez court pour ne pas laisser traîner un code
 * actif indéfiniment si le partenariat s'arrête sans qu'on pense à le couper.
 */
export const PARTNER_CODE_VALIDITY_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PartnerCouponPlan {
  /** Nom lisible du coupon côté Dashboard Stripe. */
  name: string;
  /** Remise en pourcentage (Stripe accepte jusqu'à 2 décimales, > 0 et ≤ 100). */
  percentOff: number;
  /** Fin de validité du coupon ET du code promo (ms epoch). */
  redeemBy: number;
}

/**
 * Un affilié mérite-t-il un code promo Stripe ?
 *
 * Non si `buyerDiscountBps` vaut 0 : Stripe exige une remise strictement
 * positive, et surtout un code qui ne donne rien à l'audience n'a aucune raison
 * d'être partagé — le lien seul suffit alors à attribuer la commission.
 *
 * Non plus au-delà de 100 % (borne Stripe). En pratique le garde-fou marge
 * (`isRewardConfigSafe`, 25 % cumulés max) mord bien avant, mais cette fonction
 * ne présume pas de son appelant.
 */
export function shouldCreatePartnerCoupon(buyerDiscountBps: number): boolean {
  return Number.isInteger(buyerDiscountBps) && buyerDiscountBps > 0 && buyerDiscountBps <= 10000;
}

/**
 * Paramètres du coupon à créer pour un affilié, ou `null` si aucun code
 * partageable n'a lieu d'être. `now` est injecté pour rester déterministe.
 *
 * `buyerDiscountBps` étant un entier, `bps / 100` tombe toujours sur au plus
 * deux décimales — le format exact qu'accepte `percent_off`.
 */
export function partnerCouponPlan(input: {
  code: string;
  buyerDiscountBps: number;
  displayName?: string | null;
  now: number;
}): PartnerCouponPlan | null {
  if (!shouldCreatePartnerCoupon(input.buyerDiscountBps)) return null;
  const percentOff = input.buyerDiscountBps / 100;
  const label = input.displayName?.trim() || input.code;
  return {
    name: `Partenaire ${label} — ${input.code} (-${percentOff} %)`,
    percentOff,
    redeemBy: input.now + PARTNER_CODE_VALIDITY_DAYS * MS_PER_DAY,
  };
}
