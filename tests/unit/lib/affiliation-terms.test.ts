import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_BPS,
  MAX_COMBINED_BPS,
  MIN_VEST_FLOOR_MS,
} from '../../../convex/lib/affiliate';
import { PARTNER_CODE_VALIDITY_DAYS } from '../../../lib/payments/affiliate-coupon';
import { routing } from '../../../i18n/routing';

/**
 * Garde-fou anti-dérive des CGU du programme partenaire.
 *
 * Les conditions (`Legal.affiliation`) chiffrent des règles qui vivent dans le
 * CODE : taux de commission, plafond de cumul, délai d'acquisition, fenêtre
 * d'attribution, validité du code. Changer une constante sans toucher au texte
 * rend les conditions FAUSSES — et des conditions fausses sur un contrat qui
 * engage de l'argent réel sont pires que pas de conditions du tout.
 *
 * Ce test échoue donc dès qu'une constante bouge sans que le texte suive.
 */

const MESSAGES_DIR = path.resolve(__dirname, '../../../messages');
const DAY_MS = 24 * 60 * 60 * 1000;

function loadFr(): Record<string, string> {
  const raw = fs.readFileSync(path.join(MESSAGES_DIR, 'fr.json'), 'utf-8');
  return JSON.parse(raw).Legal.affiliation as Record<string, string>;
}

/** Fenêtre d'attribution réellement posée par le cookie `wdb_ref` (proxy.ts). */
function cookieWindowDays(): number {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../proxy.ts'), 'utf-8');
  const match = source.match(/maxAge:\s*(\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60/);
  if (!match) throw new Error('maxAge du cookie wdb_ref introuvable dans proxy.ts');
  return Number(match[1]);
}

describe('CGU affiliation — cohérence avec le code', () => {
  const fr = loadFr();

  it('annonce le taux de commission par défaut du ledger', () => {
    expect(DEFAULT_RATE_BPS).toBe(2000);
    expect(fr.article5Body).toContain('20 %');
  });

  it('annonce le plafond de cumul remise + commission appliqué au serveur', () => {
    expect(MAX_COMBINED_BPS).toBe(2500);
    expect(fr.article5Body).toContain('25 %');
  });

  it('annonce le plancher d’acquisition de sept jours', () => {
    expect(MIN_VEST_FLOOR_MS).toBe(7 * DAY_MS);
    expect(fr.article6Body).toContain('sept jours');
  });

  it('annonce la fenêtre d’attribution réellement posée par le cookie', () => {
    expect(cookieWindowDays()).toBe(30);
    expect(fr.article4Body).toContain('trente jours');
  });

  it('annonce la durée de validité réelle du code promo', () => {
    expect(PARTNER_CODE_VALIDITY_DAYS).toBe(365);
    expect(fr.article3Body).toContain('douze mois');
  });

  it('dit que l’acquisition se fait à la date du mariage, pas à l’achat', () => {
    // `vestsAt` prend le MAX(date event, achat + 7j) : c'est la date du mariage
    // qui commande, le plancher n'étant qu'un garde-fou.
    expect(fr.article6Body).toContain('date du mariage');
  });

  it('exclut explicitement les abonnements pros et l’upsell HD', () => {
    // Le coupon est restreint aux produits couple côté Stripe
    // (`resolveConsumerPlanProductIds`) — le texte doit dire la même chose.
    expect(fr.article3Body).toContain('professionnels');
    expect(fr.article3Body).toContain('HD');
  });

  it('exclut l’auto-parrainage, comme `isSelfReferral` côté serveur', () => {
    expect(fr.article4Body).toContain('propres achats');
  });
});

describe('CGU affiliation — parité des locales', () => {
  const fr = loadFr();
  const expectedKeys = Object.keys(fr).sort();

  it('les 11 articles sont présents (titre + corps) plus titre et date', () => {
    // 11 articles × 2 + title + lastUpdated = 24
    expect(expectedKeys).toHaveLength(24);
    for (let i = 1; i <= 11; i++) {
      expect(fr[`article${i}Title`]).toBeTruthy();
      expect(fr[`article${i}Body`]).toBeTruthy();
    }
  });

  it('chaque locale a les mêmes clés, non vides et traduites', () => {
    for (const locale of routing.locales) {
      const raw = fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf-8');
      const section = JSON.parse(raw).Legal?.affiliation as Record<string, string> | undefined;
      expect(section, `${locale}: section Legal.affiliation absente`).toBeTruthy();
      expect(Object.keys(section!).sort(), `${locale}: clés divergentes`).toEqual(expectedKeys);
      for (const [key, value] of Object.entries(section!)) {
        expect(typeof value, `${locale}.${key}`).toBe('string');
        expect(value.trim().length, `${locale}.${key} vide`).toBeGreaterThan(0);
      }
      if (locale !== 'fr') {
        // Anti-copier-coller : un article entier identique au français signale
        // une traduction oubliée.
        expect(section!.article1Body, `${locale}: article1Body non traduit`).not.toBe(
          fr.article1Body,
        );
      }
    }
  });
});
