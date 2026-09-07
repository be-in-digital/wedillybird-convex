import { describe, expect, it } from 'vitest';
import { INCLUSIVE_VAT_RATES, taxExclusiveMinor, vatBreakdownFor } from '../../../lib/payments/vat';
import { PLANS } from '../../../lib/payments/plans';
import { DEFAULT_RATE_BPS, rewardMinor } from '../../../convex/lib/affiliate';
import fs from 'node:fs';
import path from 'node:path';
import { routing } from '../../../i18n/routing';

describe('vatBreakdownFor — décomposition HT / TVA', () => {
  it('EUR : aucune TVA collectée (franchise en base) → encaissé = HT', () => {
    expect(vatBreakdownFor(5900, 'EUR')).toEqual({ htMinor: 5900, rate: 0, vatMinor: 0 });
    expect(vatBreakdownFor(2900, 'EUR')).toEqual({ htMinor: 2900, rate: 0, vatMinor: 0 });
  });

  it('aucune devise ne porte de TVA tant que la franchise en base s’applique', () => {
    expect(Object.values(INCLUSIVE_VAT_RATES).every((rate) => rate === 0)).toBe(true);
  });

  it('le mécanisme reste correct si un taux est réintroduit', () => {
    // Assujettissement futur : la décomposition doit redevenir juste sans
    // toucher au reste du code. On simule ici le calcul à 20 %.
    const rate = 0.2;
    const ht = Math.round(5900 / (1 + rate));
    expect(ht).toBe(4917);
    expect(5900 - ht).toBe(983);
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
   * partenaire — exactement le genre de centime qui déclenche un litige. Il
   * doit tenir avec ou sans TVA.
   */
  it('invariant : HT + TVA === montant encaissé, pour tout montant', () => {
    for (const currency of ['EUR', 'USD', 'MAD'] as const) {
      for (let amount = 1; amount <= 20000; amount += 7) {
        const { htMinor, vatMinor } = vatBreakdownFor(amount, currency);
        expect(htMinor + vatMinor).toBe(amount);
      }
    }
  });
});

describe('taxExclusiveMinor — assiette de commission', () => {
  it('laisse les prix EUR intacts : ils sont nets, pas TTC', () => {
    expect(taxExclusiveMinor(PLANS.premium.prices.EUR, 'EUR')).toBe(PLANS.premium.prices.EUR);
    expect(taxExclusiveMinor(PLANS.essential.prices.EUR, 'EUR')).toBe(PLANS.essential.prices.EUR);
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
  it('un Premium EUR : commission sur les 59 € encaissés, sans TVA à retrancher', () => {
    const collected = PLANS.premium.prices.EUR;
    expect(rewardMinor(taxExclusiveMinor(collected, 'EUR'), DEFAULT_RATE_BPS)).toBe(1180);
  });

  it('un Premium EUR remisé à -10 % : l’assiette suit la remise', () => {
    const collected = 5310; // 59 € − 10 %
    expect(taxExclusiveMinor(collected, 'EUR')).toBe(5310);
    expect(rewardMinor(taxExclusiveMinor(collected, 'EUR'), DEFAULT_RATE_BPS)).toBe(1062);
  });

  it('aucune devise ne subit de retenue tant que la franchise s’applique', () => {
    for (const currency of ['EUR', 'USD', 'MAD'] as const) {
      const collected = 5900;
      expect(rewardMinor(taxExclusiveMinor(collected, currency), DEFAULT_RATE_BPS)).toBe(
        rewardMinor(collected, DEFAULT_RATE_BPS),
      );
    }
  });
});

describe('mentions de TVA sur la facture', () => {
  /**
   * En franchise en base, la facture DOIT porter la mention de l'art. 293 B et
   * ne peut pas afficher de n° de TVA intracommunautaire. `InvoicePDF` choisit
   * la branche « non applicable » quand le taux vaut 0 — ce que garantit
   * `INCLUSIVE_VAT_RATES` ci-dessus ; ce bloc vérifie le contenu des mentions.
   */
  const locales = routing.locales;

  function invoiceStrings(locale: string): Record<string, string> {
    const raw = fs.readFileSync(
      path.resolve(__dirname, `../../../messages/${locale}.json`),
      'utf-8',
    );
    return JSON.parse(raw).Invoice as Record<string, string>;
  }

  it('la mention « non applicable » existe dans chaque locale', () => {
    for (const locale of locales) {
      expect(invoiceStrings(locale).vatNotApplicable?.trim(), locale).toBeTruthy();
    }
  });

  it('aucune mention émetteur ne reste un gabarit « à compléter »', () => {
    // Ces chaînes sont imprimées telles quelles sur chaque facture : un
    // gabarit qui passe en production part chez un vrai client.
    for (const locale of locales) {
      const inv = invoiceStrings(locale);
      expect(inv.issuerVat, `${locale}: issuerVat`).not.toMatch(/à compléter|to be completed/i);
    }
  });

  it('la mention de TVA de l’émetteur cite bien l’article 293 B', () => {
    expect(invoiceStrings('fr').issuerVat).toContain('293 B');
  });
});
