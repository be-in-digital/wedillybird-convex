/**
 * TVA — passage d'un montant encaissé à son montant hors taxes.
 *
 * Source unique de la règle, partagée par la **facture** (`invoice.tsx`) et par
 * l'**assiette de commission** du programme partenaire. Les deux DOIVENT donner
 * le même HT : un partenaire qui recalcule sa commission depuis la facture d'un
 * couple doit tomber sur notre chiffre, sinon chaque écart devient un litige.
 *
 * Stripe ne calcule aucune taxe sur ce compte (ni `automatic_tax`, ni
 * `tax_behavior` sur les Prices) : `amount_total` est donc le montant TTC tel
 * qu'affiché, et `total_details.amount_tax` vaut zéro. C'est pourquoi le HT est
 * déduit ici du taux applicable, et non lu depuis Stripe.
 *
 * Règle actuelle :
 *  - **EUR** : prix affichés TTC, TVA française 20 % incluse.
 *  - **USD** : prix affichés HT (cf. `Plans.usTaxNote`) — rien à déduire.
 *  - **XOF / MAD / TND** : TVA non applicable côté Wedillybird
 *    (art. 293 B du CGI), refacturation locale par le client si requise.
 */

import type { Currency } from './plans';

/** Taux de TVA inclus dans le prix affiché, par devise. 0 = prix déjà HT. */
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
 * commission d'affiliation. Commissionner le TTC reviendrait à rémunérer le
 * partenaire sur de la TVA qui n'est pas un revenu (elle est reversée à l'État).
 */
export function taxExclusiveMinor(amountMinor: number, currency: Currency): number {
  return vatBreakdownFor(amountMinor, currency).htMinor;
}
