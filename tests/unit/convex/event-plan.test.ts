import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_COMPED_EVENT_PLAN,
  GALLERY_RETENTION_DAYS,
  MS_PER_DAY,
  POST_EVENT_UPSELL_RETENTION_DAYS,
  galleryExpiresAtFor,
} from '../../../convex/lib/eventPlan';

const EVENT_DATE = Date.UTC(2026, 5, 20); // 20 juin 2026

describe('galleryExpiresAtFor — rétention galerie par forfait', () => {
  it('Essentiel : J+30 après l’event', () => {
    expect(galleryExpiresAtFor('essential', EVENT_DATE)).toBe(EVENT_DATE + 30 * MS_PER_DAY);
  });

  it('Premium : J+180 après l’event', () => {
    expect(galleryExpiresAtFor('premium', EVENT_DATE)).toBe(EVENT_DATE + 180 * MS_PER_DAY);
  });

  it('compte à partir de la DATE DE L’EVENT, pas de la date de paiement', () => {
    // Un forfait offert des mois avant le mariage doit expirer après le
    // mariage, pas 30 jours après le geste commercial.
    expect(galleryExpiresAtFor('premium', EVENT_DATE)).toBeGreaterThan(EVENT_DATE);
  });

  it('la grille reste alignée sur la promesse commerciale (30 j / 6 mois)', () => {
    expect(GALLERY_RETENTION_DAYS.essential).toBe(30);
    expect(GALLERY_RETENTION_DAYS.premium).toBe(180);
    expect(POST_EVENT_UPSELL_RETENTION_DAYS).toBe(5 * 365);
  });

  /**
   * L'octroi commercial (`admin:grantEventPlan`) et le paiement Stripe
   * (`payments:markSucceeded`) écrivent tous deux `galleryExpiresAt` : ils
   * DOIVENT produire la même date, sinon un compte offert perd sa galerie au
   * mauvais moment.
   */
  it('déterministe — deux appels donnent la même échéance', () => {
    expect(galleryExpiresAtFor('premium', EVENT_DATE)).toBe(
      galleryExpiresAtFor('premium', EVENT_DATE),
    );
  });
});

/**
 * Forfait offert à un particulier. Comme le compte agence offert
 * (`DEFAULT_PARTNER_COMP_TIER`), le geste commercial donne le palier COMPLET :
 * offrir l'Essentiel montrerait le produit amputé de ce qui le vend.
 */
describe('DEFAULT_COMPED_EVENT_PLAN', () => {
  it('le défaut est Premium', () => {
    expect(DEFAULT_COMPED_EVENT_PLAN).toBe('premium');
  });

  it('il ouvre bien six mois de galerie, pas trente jours', () => {
    expect(galleryExpiresAtFor(DEFAULT_COMPED_EVENT_PLAN, EVENT_DATE)).toBe(
      EVENT_DATE + 180 * MS_PER_DAY,
    );
  });

  it('`grantEventPlan` rend le tier optionnel et retombe sur ce défaut', () => {
    const admin = readFileSync('convex/admin.ts', 'utf8');
    const fn = admin.slice(admin.indexOf('export const grantEventPlan'));
    const body = fn.slice(0, fn.indexOf('\n});'));
    expect(body).toContain(
      "planTier: v.optional(v.union(v.literal('essential'), v.literal('premium')))",
    );
    expect(body).toContain('const tier = planTier ?? DEFAULT_COMPED_EVENT_PLAN;');
    // Le tier réellement posé doit atterrir dans l'audit : `planTier` seul y
    // écrirait `null` sur un octroi par défaut.
    expect(body).toContain('planTier: tier');
  });

  it("l'écran admin offre Premium sans passer de tier — le serveur tranche", () => {
    // Un menu où il faut encore choisir n'a pas de défaut : le bouton
    // principal n'envoie aucun tier.
    const table = readFileSync('components/admin/admin-events-table.tsx', 'utf8');
    expect(table).toContain('grantPlan(event._id, undefined, undefined)');
    expect(table).toContain("grantPlan(event._id, 'essential', undefined)");
    expect(table).not.toContain('events.grantPlanPlaceholder');
  });
});
