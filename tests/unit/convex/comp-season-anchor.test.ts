import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARTNER_COMP_MONTHS,
  addMonthsUtc,
  compExpiresAt,
  isHighSeason,
} from '../../../convex/lib/partnerInvite';

const MONTH_NAMES = [
  'jan',
  'fév',
  'mar',
  'avr',
  'mai',
  'juin',
  'juil',
  'août',
  'sep',
  'oct',
  'nov',
  'déc',
];

/**
 * Le produit se juge AU mariage : RSVP, check-in, galerie. Une planneuse ne
 * bascule pas dans un nouvel outil un mariage dont les invitations sont
 * parties, donc le premier qu'elle y fera vraiment passer est de la saison
 * suivante. Une échéance qui retombe en pleine saison arrive au pire moment :
 * charge de travail maximale, et fermeture des galeries en pleine livraison.
 */
describe('isHighSeason', () => {
  it('mai à septembre inclus', () => {
    for (const month of [4, 5, 6, 7, 8]) {
      expect(isHighSeason(Date.UTC(2027, month, 15)), MONTH_NAMES[month]).toBe(true);
    }
  });

  it('octobre à avril : hors saison', () => {
    for (const month of [9, 10, 11, 0, 1, 2, 3]) {
      expect(isHighSeason(Date.UTC(2027, month, 15)), MONTH_NAMES[month]).toBe(false);
    }
  });

  it('les bornes exactes comptent', () => {
    expect(isHighSeason(Date.UTC(2027, 3, 30))).toBe(false); // 30 avril
    expect(isHighSeason(Date.UTC(2027, 4, 1))).toBe(true); // 1er mai
    expect(isHighSeason(Date.UTC(2027, 8, 30))).toBe(true); // 30 septembre
    expect(isHighSeason(Date.UTC(2027, 9, 1))).toBe(false); // 1er octobre
  });
});

describe('compExpiresAt — ancrage hors saison', () => {
  it('une échéance hors saison est laissée telle quelle', () => {
    // Inscription en octobre + 12 mois = octobre : rien à corriger.
    const granted = Date.UTC(2026, 9, 12);
    expect(compExpiresAt(granted, 12)).toBe(addMonthsUtc(granted, 12));
  });

  it('une échéance en pleine saison est repoussée au 31 janvier suivant', () => {
    // Inscription en juin — le mois où une partenaire entend parler de nous.
    const granted = Date.UTC(2026, 5, 10);
    const anchored = compExpiresAt(granted, 12);
    const d = new Date(anchored);
    expect(d.getUTCFullYear()).toBe(2028);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(31);
  });

  it('elle est TOUJOURS repoussée, jamais avancée', () => {
    // Avancer trahirait la durée promise dans l'e-mail d'invitation.
    for (let month = 0; month < 12; month += 1) {
      const granted = Date.UTC(2026, month, 15);
      const raw = addMonthsUtc(granted, DEFAULT_PARTNER_COMP_MONTHS);
      expect(compExpiresAt(granted), MONTH_NAMES[month]).toBeGreaterThanOrEqual(raw);
    }
  });

  it('aucune échéance ne tombe plus en haute saison, quel que soit le mois', () => {
    // L'invariant qui justifie tout le reste.
    for (let month = 0; month < 12; month += 1) {
      for (const day of [1, 15, 28]) {
        const granted = Date.UTC(2026, month, day);
        expect(isHighSeason(compExpiresAt(granted)), `${day} ${MONTH_NAMES[month]}`).toBe(false);
      }
    }
  });

  it('le cadeau couvre toujours au moins une saison complète', () => {
    // C'est l'invariant qui justifie tout : sans une saison entière vécue dans
    // l'outil, la partenaire n'a vu qu'un CRM. La saison couverte est celle de
    // l'année d'inscription ou la suivante selon le mois — on demande donc
    // qu'il en existe UNE, pas laquelle.
    for (let month = 0; month < 12; month += 1) {
      const granted = Date.UTC(2026, month, 15);
      const end = compExpiresAt(granted);
      const covers = [2026, 2027, 2028].some(
        (year) => granted <= Date.UTC(year, 4, 1) && end >= Date.UTC(year, 8, 30),
      );
      expect(covers, MONTH_NAMES[month]).toBe(true);
    }
  });

  it("l'ancrage joue aussi sur une durée non standard", () => {
    // Un cadeau de 6 mois posé en décembre tomberait en juin.
    const granted = Date.UTC(2026, 11, 1);
    expect(isHighSeason(addMonthsUtc(granted, 6))).toBe(true);
    expect(isHighSeason(compExpiresAt(granted, 6))).toBe(false);
  });
});
