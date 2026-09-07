import { describe, expect, it } from 'vitest';
import { INCLUSIVE_VAT_RATES, taxExclusiveMinor, vatBreakdownFor } from '../../../lib/payments/vat';
import { PLANS } from '../../../lib/payments/plans';
import { DEFAULT_RATE_BPS, rewardMinor } from '../../../convex/lib/affiliate';
import fs from 'node:fs';
import path from 'node:path';
import { routing } from '../../../i18n/routing';

describe('vatBreakdownFor — décomposition HT / TVA', () => {
  it('EUR : les prix affichés sont TTC, la TVA de 20 % en est extraite', () => {
    expect(vatBreakdownFor(5900, 'EUR')).toEqual({ htMinor: 4917, rate: 0.2, vatMinor: 983 });
    expect(vatBreakdownFor(2900, 'EUR')).toEqual({ htMinor: 2417, rate: 0.2, vatMinor: 483 });
  });

  it('USD : prix déjà affichés HT, rien à déduire', () => {
    expect(vatBreakdownFor(8000, 'USD')).toEqual({ htMinor: 8000, rate: 0, vatMinor: 0 });
  });

  it('MAD / TND / XOF : hors du champ de la TVA française', () => {
    for (const currency of ['MAD', 'TND', 'XOF'] as const) {
      expect(vatBreakdownFor(10000, currency).htMinor).toBe(10000);
      expect(vatBreakdownFor(10000, currency).vatMinor).toBe(0);
    }
  });

  it('seul l’EUR porte un taux : la devise dit le pays de facturation', () => {
    // La devise suit le pays de facturation (géoIP → cookie `wbb_ccy`), donc
    // elle sert de critère de territorialité. Poser un taux sur une devise
    // hors UE reviendrait à réclamer de la TVA française à un client qui n'en
    // doit pas.
    expect(INCLUSIVE_VAT_RATES.EUR).toBe(0.2);
    for (const currency of ['USD', 'XOF', 'MAD', 'TND'] as const) {
      expect(INCLUSIVE_VAT_RATES[currency], currency).toBe(0);
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
    for (const currency of ['EUR', 'USD', 'MAD'] as const) {
      for (let amount = 1; amount <= 20000; amount += 7) {
        const { htMinor, vatMinor } = vatBreakdownFor(amount, currency);
        expect(htMinor + vatMinor).toBe(amount);
      }
    }
  });

  it('la TVA extraite n’excède jamais le taux annoncé', () => {
    for (let amount = 1; amount <= 20000; amount += 13) {
      const { vatMinor } = vatBreakdownFor(amount, 'EUR');
      expect(vatMinor).toBeLessThanOrEqual(Math.ceil(amount * (0.2 / 1.2)) + 1);
    }
  });
});

describe('taxExclusiveMinor — assiette de commission', () => {
  it('retranche la TVA des prix EUR, qui sont TTC', () => {
    expect(taxExclusiveMinor(PLANS.premium.prices.EUR, 'EUR')).toBe(4917);
    expect(taxExclusiveMinor(PLANS.essential.prices.EUR, 'EUR')).toBe(2417);
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
  it('un Premium EUR : commission sur les 49,17 € HT, pas sur les 59 € encaissés', () => {
    const collected = PLANS.premium.prices.EUR;
    expect(rewardMinor(taxExclusiveMinor(collected, 'EUR'), DEFAULT_RATE_BPS)).toBe(983);
    // Ce que la commission aurait coûté sur le TTC — l'écart est la raison
    // d'être de ce module.
    expect(rewardMinor(collected, DEFAULT_RATE_BPS)).toBe(1180);
  });

  it('un Premium EUR remisé à -10 % : l’assiette suit la remise ET la TVA', () => {
    const collected = 5310; // 59 € − 10 %
    expect(taxExclusiveMinor(collected, 'EUR')).toBe(4425);
    expect(rewardMinor(taxExclusiveMinor(collected, 'EUR'), DEFAULT_RATE_BPS)).toBe(885);
  });

  it('hors zone euro, aucune retenue : l’assiette égale l’encaissé', () => {
    for (const currency of ['USD', 'MAD'] as const) {
      const collected = 5900;
      expect(rewardMinor(taxExclusiveMinor(collected, currency), DEFAULT_RATE_BPS)).toBe(
        rewardMinor(collected, DEFAULT_RATE_BPS),
      );
    }
  });
});

describe('mentions de TVA sur la facture', () => {
  /**
   * `InvoicePDF` choisit la branche HT + TVA quand le taux est > 0, et la
   * mention « non applicable » sinon. Ce bloc vérifie le contenu des mentions
   * dans les sept locales : ce sont des chaînes imprimées telles quelles sur
   * de vraies factures.
   */
  const locales = routing.locales;

  function invoiceStrings(locale: string): Record<string, string> {
    const raw = fs.readFileSync(
      path.resolve(__dirname, `../../../messages/${locale}.json`),
      'utf-8',
    );
    return JSON.parse(raw).Invoice as Record<string, string>;
  }

  it('les libellés d’identification de l’émetteur existent partout', () => {
    for (const locale of locales) {
      const inv = invoiceStrings(locale);
      for (const key of ['issuerSiren', 'issuerSiret', 'issuerVatNumber']) {
        expect(inv[key]?.trim(), `${locale}: ${key}`).toBeTruthy();
        // Ce sont des gabarits : sans `{value}`, le numéro ne s'imprime pas.
        expect(inv[key], `${locale}: ${key} sans {value}`).toContain('{value}');
      }
    }
  });

  it('aucune mention émetteur ne reste un gabarit « à compléter »', () => {
    for (const locale of locales) {
      const inv = invoiceStrings(locale);
      for (const [key, value] of Object.entries(inv)) {
        if (!key.startsWith('issuer')) continue;
        expect(value, `${locale}: ${key}`).not.toMatch(/à compléter|to be completed/i);
      }
    }
  });

  it('plus aucune facture ne cite la franchise en base (art. 293 B)', () => {
    // L'entité est assujettie : afficher 293 B serait une fausse mention
    // fiscale sur un document opposable.
    for (const locale of locales) {
      for (const [key, value] of Object.entries(invoiceStrings(locale))) {
        if (typeof value !== 'string') continue;
        expect(value, `${locale}: ${key}`).not.toMatch(/293/);
      }
    }
  });

  it('la mention « non applicable » dit pourquoi, dans chaque locale', () => {
    for (const locale of locales) {
      expect(invoiceStrings(locale).vatNotApplicable?.trim(), locale).toBeTruthy();
    }
  });
});
