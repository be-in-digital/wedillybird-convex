import { describe, expect, it } from 'vitest';
import { buyerDiscountMinor, splitOrderDiscounts } from '../../../lib/payments/affiliate-discount';
import { PLANS } from '../../../lib/payments/plans';

describe('buyerDiscountMinor — remise filleul en centimes', () => {
  it('applique le taux au prix catalogue', () => {
    expect(buyerDiscountMinor(5900, 1000)).toBe(590); // Premium 59 € → -10 % = 5,90 €
    expect(buyerDiscountMinor(2900, 1500)).toBe(435); // Essentiel 29 € → -15 %
  });

  it('arrondit à l’entier (jamais de fraction de centime)', () => {
    expect(buyerDiscountMinor(2900, 1000)).toBe(290);
    expect(buyerDiscountMinor(999, 1000)).toBe(100); // 99,9 → 100
    expect(buyerDiscountMinor(15, 1500)).toBe(2); // 2,25 → 2
  });

  it('vaut 0 sans remise configurée ou sur entrée invalide', () => {
    expect(buyerDiscountMinor(5900, 0)).toBe(0);
    expect(buyerDiscountMinor(0, 1000)).toBe(0);
    expect(buyerDiscountMinor(-5900, 1000)).toBe(0);
    expect(buyerDiscountMinor(5900, -1000)).toBe(0);
    expect(buyerDiscountMinor(Number.NaN, 1000)).toBe(0);
    expect(buyerDiscountMinor(5900, Number.NaN)).toBe(0);
  });

  it('ne dépasse jamais la commande, même à 100 %+', () => {
    expect(buyerDiscountMinor(5900, 10000)).toBe(5900);
    expect(buyerDiscountMinor(5900, 20000)).toBe(5900);
  });
});

describe('splitOrderDiscounts — un seul coupon, jamais de sur-remise', () => {
  it('sans affilié ni crédit : aucun coupon', () => {
    expect(
      splitOrderDiscounts({ orderMinor: 5900, buyerDiscountBps: 0, creditAvailableMinor: 0 }),
    ).toEqual({ discountMinor: 0, creditBudgetMinor: 5900, couponMinor: 0 });
  });

  it('remise seule : le coupon vaut la remise', () => {
    const s = splitOrderDiscounts({
      orderMinor: 5900,
      buyerDiscountBps: 1000,
      creditAvailableMinor: 0,
    });
    expect(s.discountMinor).toBe(590);
    expect(s.couponMinor).toBe(590);
  });

  it('crédit seul (comportement historique préservé)', () => {
    const s = splitOrderDiscounts({
      orderMinor: 5900,
      buyerDiscountBps: 0,
      creditAvailableMinor: 1200,
    });
    expect(s.discountMinor).toBe(0);
    expect(s.creditBudgetMinor).toBe(5900);
    expect(s.couponMinor).toBe(1200);
  });

  it('remise + crédit fusionnent dans un coupon unique', () => {
    const s = splitOrderDiscounts({
      orderMinor: 5900,
      buyerDiscountBps: 1000,
      creditAvailableMinor: 1200,
    });
    expect(s.discountMinor).toBe(590);
    expect(s.creditBudgetMinor).toBe(5310); // le crédit ne mord que sur le reste
    expect(s.couponMinor).toBe(1790);
  });

  it('plafonne le crédit au reliquat — le coupon ne dépasse jamais la commande', () => {
    const s = splitOrderDiscounts({
      orderMinor: 5900,
      buyerDiscountBps: 1000,
      creditAvailableMinor: 999_999,
    });
    expect(s.creditBudgetMinor).toBe(5310);
    expect(s.couponMinor).toBe(5900);
  });

  it('remise à 100 % : plus aucun budget crédit (rien à brûler pour rien)', () => {
    const s = splitOrderDiscounts({
      orderMinor: 5900,
      buyerDiscountBps: 10000,
      creditAvailableMinor: 2000,
    });
    expect(s.discountMinor).toBe(5900);
    expect(s.creditBudgetMinor).toBe(0);
    expect(s.couponMinor).toBe(5900);
  });

  it('ignore un crédit négatif ou non fini', () => {
    const base = { orderMinor: 5900, buyerDiscountBps: 1000 };
    expect(splitOrderDiscounts({ ...base, creditAvailableMinor: -500 }).couponMinor).toBe(590);
    expect(splitOrderDiscounts({ ...base, creditAvailableMinor: Number.NaN }).couponMinor).toBe(
      590,
    );
  });

  it('commande invalide → tout à zéro', () => {
    expect(
      splitOrderDiscounts({ orderMinor: 0, buyerDiscountBps: 2000, creditAvailableMinor: 500 }),
    ).toEqual({ discountMinor: 0, creditBudgetMinor: 0, couponMinor: 0 });
  });

  /**
   * L'invariant qui protège l'argent : le coupon posé sur la session vaut
   * EXACTEMENT remise + crédit réservé. Toute dérive signifierait soit une
   * sur-remise (on perd de la marge), soit du crédit consommé sans être
   * appliqué (on vole le parrain).
   */
  it('invariant : couponMinor === discountMinor + crédit effectivement appliqué', () => {
    for (const orderMinor of [2900, 5900, 4000, 8000, 7900]) {
      for (const bps of [0, 500, 1000, 1500, 2500]) {
        for (const credit of [0, 100, 2000, 100_000]) {
          const s = splitOrderDiscounts({
            orderMinor,
            buyerDiscountBps: bps,
            creditAvailableMinor: credit,
          });
          const appliedCredit = Math.min(credit, s.creditBudgetMinor);
          expect(s.couponMinor).toBe(s.discountMinor + appliedCredit);
          expect(s.couponMinor).toBeLessThanOrEqual(orderMinor);
        }
      }
    }
  });
});

describe('cas réels de la grille tarifaire', () => {
  it('Premium EUR avec un code partenaire à -10 %', () => {
    const order = PLANS.premium.prices.EUR;
    const s = splitOrderDiscounts({
      orderMinor: order,
      buyerDiscountBps: 1000,
      creditAvailableMinor: 0,
    });
    expect(order - s.couponMinor).toBe(5310); // 59 € → 53,10 € encaissés
  });

  it('Essentiel EUR avec un code partenaire à -10 %', () => {
    const order = PLANS.essential.prices.EUR;
    const s = splitOrderDiscounts({
      orderMinor: order,
      buyerDiscountBps: 1000,
      creditAvailableMinor: 0,
    });
    expect(order - s.couponMinor).toBe(2610); // 29 € → 26,10 € encaissés
  });
});
