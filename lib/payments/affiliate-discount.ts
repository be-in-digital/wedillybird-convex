/**
 * Remise filleul d'un code affilié — logique PURE, appliquée au checkout.
 *
 * Le ledger d'affiliation (`convex/affiliate.ts`) portait déjà `buyerDiscountBps`
 * sur chaque affilié, mais **rien ne le lisait au checkout** : un code partenaire
 * traçait la commission sans jamais remiser l'acheteur. Ces helpers comblent ce
 * trou, côté app (le montant du coupon Stripe est décidé par la route, pas par
 * Convex).
 *
 * Contrainte Stripe qui dicte la forme : `discounts` n'accepte **qu'un seul**
 * coupon, et sa présence exclut `allow_promotion_codes`. Remise affiliée et
 * crédit de parrainage doivent donc fusionner en un coupon unique.
 *
 * Le garde-fou de marge (remise + commission ≤ 25 %) vit côté Convex dans
 * `convex/lib/affiliate.ts:isRewardConfigSafe`, à la création de l'affilié —
 * inutile de le redupliquer ici : un `buyerDiscountBps` persisté est déjà sûr.
 */

/**
 * Remise offerte au filleul, en centimes = `buyerDiscountBps` × commande /
 * 10000, arrondie à l'entier. Bornée à `[0, orderMinor]` : le coupon ne peut
 * jamais dépasser la commande (Stripe l'accepterait, mais le net encaissé
 * deviendrait négatif — or c'est lui qui sert de base à la commission).
 */
export function buyerDiscountMinor(orderMinor: number, buyerDiscountBps: number): number {
  if (!Number.isFinite(orderMinor) || !Number.isFinite(buyerDiscountBps)) return 0;
  if (orderMinor <= 0 || buyerDiscountBps <= 0) return 0;
  return Math.min(orderMinor, Math.round((orderMinor * buyerDiscountBps) / 10000));
}

export interface OrderDiscountSplit {
  /** Remise affiliée, en centimes. */
  discountMinor: number;
  /** Budget maximal que le crédit de parrainage peut encore consommer. */
  creditBudgetMinor: number;
  /** Montant du coupon unique à poser sur la session (remise + crédit). */
  couponMinor: number;
}

/**
 * Répartit une commande entre remise affiliée et crédit de parrainage.
 *
 * La remise affiliée s'applique **en premier**, le crédit ne mord que sur le
 * reliquat : le crédit est *réservé* ligne par ligne côté ledger, donc en
 * réserver plus que ce que le coupon applique reviendrait à brûler du crédit
 * jamais consommé. En plafonnant le crédit au reliquat, on garantit
 * `couponMinor === discountMinor + crédit réservé` — ni sur-remise, ni crédit
 * perdu pour le parrain.
 *
 * Appeler d'abord avec `creditAvailableMinor: 0` pour obtenir le
 * `creditBudgetMinor` à passer à `reserveCreditForCheckout`, puis rappeler avec
 * le montant réellement réservé pour connaître `couponMinor`.
 */
export function splitOrderDiscounts(input: {
  orderMinor: number;
  buyerDiscountBps: number;
  creditAvailableMinor: number;
}): OrderDiscountSplit {
  const orderMinor =
    Number.isFinite(input.orderMinor) && input.orderMinor > 0 ? input.orderMinor : 0;
  const discountMinor = buyerDiscountMinor(orderMinor, input.buyerDiscountBps);
  const creditBudgetMinor = Math.max(0, orderMinor - discountMinor);
  const credit =
    Number.isFinite(input.creditAvailableMinor) && input.creditAvailableMinor > 0
      ? Math.min(input.creditAvailableMinor, creditBudgetMinor)
      : 0;
  return { discountMinor, creditBudgetMinor, couponMinor: discountMinor + credit };
}
