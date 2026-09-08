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

import {
  STRIPE_COUPON_NAME_MAX_LENGTH,
  couponNameLength,
  truncateCouponSegment,
} from './coupon-name';

/**
 * Durée de validité d'un code partenaire. Un an : assez long pour une
 * collaboration qui s'installe, assez court pour ne pas laisser traîner un code
 * actif indéfiniment si le partenariat s'arrête sans qu'on pense à le couper.
 */
export const PARTNER_CODE_VALIDITY_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Séparateur du nom de coupon — compact, lisible dans la liste Stripe. */
const SEP = ' · ';

/**
 * En dessous de ce nombre de caractères, un fragment de nom d'affichage
 * n'apprend plus rien (« Sar… ») : on préfère l'omettre et laisser le code
 * parler seul.
 */
const MIN_DISPLAY_NAME_CHARS = 6;

export interface PartnerCouponPlan {
  /** Nom lisible du coupon côté Dashboard Stripe (≤ 40 car., limite Stripe). */
  name: string;
  /** Remise en pourcentage (Stripe accepte jusqu'à 2 décimales, > 0 et ≤ 100). */
  percentOff: number;
  /** Fin de validité du coupon ET du code promo (ms epoch). */
  redeemBy: number;
  /**
   * Marqueur machine du coupon. Le nom étant budgété au caractère près, c'est
   * la metadata — et non un préfixe « Partenaire » — qui rend ces coupons
   * filtrables dans le Dashboard et rattachables à leur affilié.
   */
  metadata: Record<string, string>;
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
 * Nom du coupon partenaire, garanti dans la limite Stripe de 40 caractères.
 *
 * Un nom trop long n'était pas tronqué par Stripe mais REFUSÉ (400) : l'affilié
 * se retrouvait créé sans code partageable. Le budget est donc dépensé par
 * ordre de valeur d'identification :
 *
 *  1. le **code** — c'est lui qui relie le coupon à l'affilié (`markSucceeded`
 *     remonte du code promo vers `affiliates.code`), il n'est jamais sacrifié ;
 *  2. le **taux**, qui dit ce que le coupon fait ;
 *  3. le **nom d'affichage**, confort de lecture : rogné, puis omis s'il ne
 *     reste pas de place pour un fragment parlant.
 *
 * Le nom d'affichage est aussi omis quand il redit le code (cas par défaut,
 * `displayName` vide) — « SARAH · -10 % · SARAH » n'apprend rien à personne.
 */
function partnerCouponName(input: {
  code: string;
  percentOff: number;
  displayName?: string | null;
}): string {
  const head = `${input.code}${SEP}-${input.percentOff} %`;
  const label = input.displayName?.trim() ?? '';

  // Le code seul peut déjà dépasser (jusqu'à 24 car. + taux) : on borne.
  if (!label || label.toUpperCase() === input.code.toUpperCase()) {
    return truncateCouponSegment(head, STRIPE_COUPON_NAME_MAX_LENGTH);
  }

  const budget = STRIPE_COUPON_NAME_MAX_LENGTH - couponNameLength(head) - couponNameLength(SEP);
  if (budget < MIN_DISPLAY_NAME_CHARS) {
    return truncateCouponSegment(head, STRIPE_COUPON_NAME_MAX_LENGTH);
  }
  return `${head}${SEP}${truncateCouponSegment(label, budget)}`;
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
  return {
    name: partnerCouponName({
      code: input.code,
      percentOff,
      displayName: input.displayName,
    }),
    percentOff,
    redeemBy: input.now + PARTNER_CODE_VALIDITY_DAYS * MS_PER_DAY,
    metadata: { wedillybird: 'partner_code', wedillybird_affiliate_code: input.code },
  };
}
