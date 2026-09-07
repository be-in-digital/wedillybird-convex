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
 * Règle actuelle : **aucune TVA n'est facturée, quelle que soit la devise.**
 * L'entité qui exploite Wedillybird relève de la franchise en base de TVA
 * (art. 293 B du CGI) : elle ne collecte pas de TVA, donc le montant encaissé
 * EST le montant hors taxes. Les prix EUR affichés (29 € / 59 €) sont nets, pas
 * TTC. Les prix USD sont eux aussi affichés HT (cf. `Plans.usTaxNote`).
 *
 * ⚠️ **À changer le jour où l'entité devient redevable de la TVA** (sortie de
 * franchise, changement de forme juridique) : repasser `EUR` à `0.2` suffit —
 * la facture isolera de nouveau HT + TVA au lieu de la mention 293 B, et
 * l'assiette de commission suivra automatiquement. C'est la raison d'être de ce
 * module : une seule constante commande les deux.
 */

import type { Currency } from './plans';

/**
 * Taux de TVA inclus dans le prix affiché, par devise. 0 = prix déjà HT.
 * Tout à zéro tant que Wedillybird est en franchise en base (art. 293 B).
 */
export const INCLUSIVE_VAT_RATES: Record<Currency, number> = {
  EUR: 0,
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
 * rémunérer le partenaire sur de la TVA, qui n'est pas un revenu (elle est
 * reversée à l'État). En franchise en base, aucune TVA n'étant collectée, cette
 * fonction rend le montant inchangé — le mécanisme reste en place pour le jour
 * où l'entité y sera assujettie.
 */
export function taxExclusiveMinor(amountMinor: number, currency: Currency): number {
  return vatBreakdownFor(amountMinor, currency).htMinor;
}
