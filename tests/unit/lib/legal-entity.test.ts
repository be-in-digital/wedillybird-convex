import { describe, expect, it } from 'vitest';
import {
  formatSiren,
  formatSiret,
  frenchVatKey,
  frenchVatNumber,
  HOST_PROVIDER,
  isValidSiren,
  LEGAL_ENTITY,
  pendingLegalFields,
} from '../../../lib/legal/entity';

/**
 * L'identité légale s'imprime sur des factures et engage l'entreprise. Une
 * faute de frappe dans un SIREN ou un numéro de TVA ne se voit pas à la
 * relecture — elle se voit à un contrôle. D'où ces vérifications mécaniques.
 */

describe('SIREN', () => {
  it('celui de l’entité respecte sa clé de contrôle', () => {
    expect(isValidSiren(LEGAL_ENTITY.siren)).toBe(true);
  });

  it('rejette un SIREN dont un chiffre a été changé', () => {
    // Un seul chiffre modifié doit casser la clé : c'est précisément ce que
    // Luhn détecte, et le mode de faute le plus probable ici.
    const broken = `${LEGAL_ENTITY.siren.slice(0, 4)}${(Number(LEGAL_ENTITY.siren[4]) + 1) % 10}${LEGAL_ENTITY.siren.slice(5)}`;
    expect(broken).not.toBe(LEGAL_ENTITY.siren);
    expect(isValidSiren(broken)).toBe(false);
  });

  it('rejette ce qui n’est pas neuf chiffres', () => {
    expect(isValidSiren('12345678')).toBe(false);
    expect(isValidSiren('1234567890')).toBe(false);
    expect(isValidSiren('93081769a')).toBe(false);
    expect(isValidSiren('')).toBe(false);
  });

  it('se présente par groupes de trois', () => {
    expect(formatSiren('930817697')).toBe('930 817 697');
  });
});

describe('TVA intracommunautaire', () => {
  it('le numéro écrit dans le module correspond au SIREN', () => {
    // La clé se DÉDUIT du SIREN : si les deux divergent, l'un des deux a été
    // recopié à la main de travers.
    expect(LEGAL_ENTITY.vatNumber).toBe(frenchVatNumber(LEGAL_ENTITY.siren));
  });

  it('la clé suit la formule officielle (12 + 3 × SIREN mod 97) mod 97', () => {
    const siren = LEGAL_ENTITY.siren;
    const expected = (12 + 3 * (Number(siren) % 97)) % 97;
    expect(frenchVatKey(siren)).toBe(String(expected).padStart(2, '0'));
  });

  it('la clé est toujours sur deux chiffres', () => {
    for (const siren of ['930817697', '000000000', '552100554']) {
      expect(frenchVatKey(siren)).toMatch(/^\d{2}$/);
    }
  });

  it('le numéro complet a le format FR + clé + SIREN', () => {
    expect(LEGAL_ENTITY.vatNumber).toMatch(/^FR\d{11}$/);
    expect(LEGAL_ENTITY.vatNumber.endsWith(LEGAL_ENTITY.siren)).toBe(true);
  });
});

describe('mentions manquantes', () => {
  /**
   * Cette liste doit être VIDE avant la première vente : une facture sans
   * adresse de siège ni mention RCS n'est pas conforme (art. L441-9 du code de
   * commerce). Le test échoue dès qu'un champ est renseigné, pour forcer la
   * mise à jour de la liste plutôt que de la laisser mentir.
   */
  it('énumère exactement ce qui reste à fournir', () => {
    expect(pendingLegalFields()).toEqual([
      'siret',
      'legalForm',
      'shareCapitalMinor',
      'registeredAddress',
      'rcsCity',
      'publicationDirector',
      'consumerMediator',
    ]);
  });

  it('aucun champ renseigné n’est un gabarit', () => {
    for (const [key, value] of Object.entries(LEGAL_ENTITY)) {
      if (typeof value !== 'string') continue;
      expect(value.trim(), key).not.toBe('');
      expect(value, key).not.toMatch(/à compléter|to be completed|TODO|xxx/i);
    }
  });

  it('ce qui est connu l’est vraiment', () => {
    expect(LEGAL_ENTITY.legalName).toBe('Tuum Agency');
    expect(LEGAL_ENTITY.tradeName).toBe('Wedillybird');
    expect(LEGAL_ENTITY.contactEmail).toMatch(/@wedillybird\.com$/);
    expect(LEGAL_ENTITY.billingEmail).toMatch(/@wedillybird\.com$/);
    expect(HOST_PROVIDER.name).toBeTruthy();
  });
});

describe('formatSiret', () => {
  it('se présente en 3-3-3-5', () => {
    expect(formatSiret('93081769700012')).toBe('930 817 697 00012');
  });
});
