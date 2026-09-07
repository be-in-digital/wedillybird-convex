import { describe, expect, it } from 'vitest';
import { INCLUSIVE_VAT_RATES, taxExclusiveMinor, vatBreakdownFor } from '../../../lib/payments/vat';
import { PLANS } from '../../../lib/payments/plans';
import { DEFAULT_RATE_BPS, rewardMinor } from '../../../convex/lib/affiliate';

describe('vatBreakdownFor — décomposition HT / TVA', () => {
  it('EUR : TVA 20 % incluse dans le prix affiché', () => {
    expect(vatBreakdownFor(5900, 'EUR')).toEqual({ htMinor: 4917, rate: 0.2, vatMinor: 983 });
    expect(vatBreakdownFor(2900, 'EUR')).toEqual({ htMinor: 2417, rate: 0.2, vatMinor: 483 });
  });

  it('USD : prix déjà affichés HT, rien à déduire', () => {
    expect(vatBreakdownFor(8000, 'USD')).toEqual({ htMinor: 8000, rate: 0, vatMinor: 0 });
  });

  it('MAD / TND / XOF : TVA non applicable', () => {
    for (const currency of ['MAD', 'TND', 'XOF'] as const) {
      expect(vatBreakdownFor(10000, currency).htMinor).toBe(10000);
      expect(vatBreakdownFor(10000, currency).vatMinor).toBe(0);
    }
  });

  it('montant nul ou invalide → tout à zéro', () => {
    expect(vatBreakdownFor(0, 'EUR').htMinor).toBe(0);
    expect(vatBreakdownFor(-100, 'EUR').htMinor).toBe(0);
    expect(vatBreakdownFor(Number.NaN, 'EUR').htMinor).toBe(0);
  });

  /**
   * L'invariant comptable : pas un centime ne se perd à l'arrondi. Un écart
   * ici se retrouverait entre la facture du couple et la commission du
   * partenaire — exactement le genre de centime qui déclenche un litige.
   */
  it('invariant : HT + TVA === montant encaissé, pour tout montant', () => {
    for (let amount = 1; amount <= 20000; amount += 7) {
      const { htMinor, vatMinor } = vatBreakdownFor(amount, 'EUR');
      expect(htMinor + vatMinor).toBe(amount);
    }
  });
});

describe('taxExclusiveMinor — assiette de commission', () => {
  it('déduit la TVA sur les prix EUR de la grille', () => {
    expect(taxExclusiveMinor(PLANS.premium.prices.EUR, 'EUR')).toBe(4917); // 59 € → 49,17 €
    expect(taxExclusiveMinor(PLANS.essential.prices.EUR, 'EUR')).toBe(2417); // 29 € → 24,17 €
  });

  it('laisse l’USD intact (prix HT)', () => {
    expect(taxExclusiveMinor(PLANS.premium.prices.USD, 'USD')).toBe(PLANS.premium.prices.USD);
  });

  it('l’assiette est toujours ≤ au montant encaissé', () => {
    for (const amount of [1, 999, 2900, 5900, 8000]) {
      expect(taxExclusiveMinor(amount, 'EUR')).toBeLessThanOrEqual(amount);
    }
  });

  it('les taux couvrent toutes les devises supportées', () => {
    expect(Object.keys(INCLUSIVE_VAT_RATES).sort()).toEqual(
      ['EUR', 'MAD', 'TND', 'USD', 'XOF'].sort(),
    );
  });
});

describe('effet réel sur la commission partenaire', () => {
  it('un Premium EUR ne commissionne plus la TVA', () => {
    const collected = PLANS.premium.prices.EUR; // 59,00 € TTC
    const surTtc = rewardMinor(collected, DEFAULT_RATE_BPS);
    const surHt = rewardMinor(taxExclusiveMinor(collected, 'EUR'), DEFAULT_RATE_BPS);
    expect(surTtc).toBe(1180); // 11,80 € — l'ancien calcul
    expect(surHt).toBe(983); // 9,83 € — le calcul retenu
    expect(surHt).toBeLessThan(surTtc);
  });

  it('un Premium EUR remisé à -10 % : assiette et commission suivent la remise', () => {
    const collected = 5310; // 59 € − 10 %
    expect(taxExclusiveMinor(collected, 'EUR')).toBe(4425);
    expect(rewardMinor(taxExclusiveMinor(collected, 'EUR'), DEFAULT_RATE_BPS)).toBe(885);
  });

  it('en USD la commission est inchangée : les prix y sont déjà HT', () => {
    const collected = PLANS.premium.prices.USD;
    expect(rewardMinor(taxExclusiveMinor(collected, 'USD'), DEFAULT_RATE_BPS)).toBe(
      rewardMinor(collected, DEFAULT_RATE_BPS),
    );
  });
});
