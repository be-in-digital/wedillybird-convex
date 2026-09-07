/**
 * TVA — passage d'un montant encaissé à son montant hors taxes.
 *
 * Source unique de la règle, partagée par la **facture** (`invoice.tsx`) et par
 * l'**assiette de commission** du programme partenaire. Les deux DOIVENT donner
 * le même HT : un partenaire qui recalcule sa commission depuis la facture d'un
 * couple doit tomber sur notre chiffre, sinon chaque écart devient un litige.
 *
 * Stripe ne calcule aucune taxe sur ce compte (ni `automatic_tax`, ni
 * `tax_behavior` sur les Prices) : `amount_total` est le montant réclamé tel
 * qu'affiché, et `total_details.amount_tax` vaut zéro. C'est pourquoi le HT est
 * déduit ici du taux applicable, et non lu depuis Stripe.
 *
 * ## Ce que disent les taux ci-dessous
 *
 * L'entité est **assujettie à la TVA** (cf. `lib/legal/entity.ts`). La devise
 * n'est pas un caprice d'affichage : elle suit le **pays de facturation**
 * (géoIP → cookie `wbb_ccy`, cf. `proxy.ts`), donc elle indique où se situe le
 * client — ce qui est exactement le critère de territorialité.
 *
 * - **EUR → 20 %.** Vente à un particulier en France : le prix affiché est
 *   nécessairement TTC (le droit de la consommation l'impose en B2C), donc les
 *   29 € / 59 € **incluent** la TVA. Ils ne montent pas : c'est notre net qui
 *   baisse d'autant.
 * - **USD, XOF, MAD, TND → 0 %.** Client facturé hors de l'Union : une
 *   prestation de services électroniques est taxable dans le pays du preneur,
 *   pas en France. Aucune TVA française n'est due, et la facture porte la
 *   mention correspondante (`Invoice.vatNotApplicable`). Les prix USD sont du
 *   reste déjà annoncés HT (`Plans.usTaxNote`).
 *
 * ⚠️ **Limite connue.** L'EUR ne distingue pas la France du reste de la zone
 * euro. Pour un acheteur particulier dans un autre État membre, le régime OSS
 * voudrait le taux de SON pays (19 % en Allemagne, 21 % en Belgique…) — sauf
 * sous le seuil de 10 000 € de ventes intracommunautaires par an, où la TVA
 * française s'applique, ce qui est le cas ici. À revoir en franchissant ce
 * seuil : il faudra alors un taux par pays de facturation, pas par devise.
 */

import type { Currency } from './plans';

/**
 * Taux de TVA inclus dans le prix affiché, par devise. 0 = prix déjà HT, ou
 * opération hors du champ de la TVA française.
 */
export const INCLUSIVE_VAT_RATES: Record<Currency, number> = {
  EUR: 0.2,
  USD: 0,
  XOF: 0,
  MAD: 0,
  TND: 0,
};

export interface VatBreakdown {
  /** Montant hors taxes, en centimes. */
  htMinor: number;
  /** Taux appliqué (0 si le prix est déjà HT). */
  rate: number;
  /** Part de TVA, en centimes. */
  vatMinor: number;
}

/**
 * Décompose un montant encaissé en HT + TVA. L'arrondi porte sur le HT et la
 * TVA prend le reste, pour que `htMinor + vatMinor === amountMinor` **toujours**
 * — un centime perdu à l'arrondi se retrouverait sinon dans l'écart entre une
 * facture et une commission.
 */
export function vatBreakdownFor(amountMinor: number, currency: Currency): VatBreakdown {
  const rate = INCLUSIVE_VAT_RATES[currency] ?? 0;
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    return { htMinor: 0, rate, vatMinor: 0 };
  }
  if (rate <= 0) return { htMinor: amountMinor, rate: 0, vatMinor: 0 };
  const htMinor = Math.round(amountMinor / (1 + rate));
  return { htMinor, rate, vatMinor: amountMinor - htMinor };
}

/**
 * Montant hors taxes d'un encaissement — l'assiette sur laquelle se calcule la
 * commission d'affiliation. Commissionner un montant TTC reviendrait à
 * rémunérer le partenaire sur de la TVA, qui n'est pas un revenu : elle est
 * encaissée pour le compte de l'État et lui est reversée.
 */
export function taxExclusiveMinor(amountMinor: number, currency: Currency): number {
  return vatBreakdownFor(amountMinor, currency).htMinor;
}
