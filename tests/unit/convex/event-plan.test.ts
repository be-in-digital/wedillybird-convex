import { describe, expect, it } from 'vitest';
import {
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
