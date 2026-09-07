import { describe, expect, it } from 'vitest';
import {
  computePlatformAnalytics,
  computeRefundOutcome,
  median,
  type AnalyticsInput,
} from '../../../convex/lib/analytics';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 13); // 2026-06-13, point de référence fixe

/**
 * Jeu de données déterministe — voir assertions pour les effectifs attendus.
 * couples=3, events=4 (3 publiés), paiements: 2 succeeded / 1 pending / 1 failed.
 */
function fixture(): AnalyticsInput {
  return {
    users: [
      { role: 'couple', createdAt: NOW - 10 * DAY },
      { role: 'couple', createdAt: NOW - 5 * DAY },
      { role: 'couple', createdAt: NOW - 200 * DAY },
      { role: 'pro', createdAt: NOW - 100 * DAY },
      { role: 'guest', createdAt: NOW - 3 * DAY },
      { role: 'admin', createdAt: NOW - 300 * DAY },
    ],
    events: [
      {
        _id: 'e1',
        status: 'active',
        planTier: 'premium',
        eventDate: NOW + 20 * DAY,
        createdAt: NOW - 10 * DAY,
        maxGuests: 100,
      },
      {
        _id: 'e2',
        status: 'active',
        planTier: 'essential',
        eventDate: NOW + 50 * DAY,
        createdAt: NOW - 50 * DAY,
        maxGuests: 200,
      },
      {
        _id: 'e3',
        status: 'draft',
        eventDate: NOW + 100 * DAY,
        createdAt: NOW - 5 * DAY,
        maxGuests: 150,
      },
      {
        _id: 'e4',
        status: 'archived',
        planTier: 'premium',
        eventDate: NOW - 10 * DAY,
        createdAt: NOW - 70 * DAY,
        maxGuests: 50,
      },
    ],
    payments: [
      // payé récemment (last30), checkout 10 min, event créé il y a 10j
      {
        eventId: 'e1',
        status: 'succeeded',
        amountMinor: 5900,
        createdAt: NOW - 5 * DAY - 10 * 60000,
        updatedAt: NOW - 5 * DAY,
      },
      // payé période précédente (prev30), checkout 30 min
      {
        eventId: 'e2',
        status: 'succeeded',
        amountMinor: 2900,
        createdAt: NOW - 45 * DAY - 30 * 60000,
        updatedAt: NOW - 45 * DAY,
      },
      // checkout abandonné (pending)
      {
        eventId: 'e3',
        status: 'pending',
        amountMinor: 5900,
        createdAt: NOW - 2 * DAY,
        updatedAt: NOW - 2 * DAY,
      },
      // tentative échouée sur e1 (même event déjà payé)
      {
        eventId: 'e1',
        status: 'failed',
        amountMinor: 5900,
        createdAt: NOW - 6 * DAY,
        updatedAt: NOW - 6 * DAY,
      },
    ],
    orgs: [
      { subscriptionTier: 'starter', subscriptionStatus: 'active' },
      { subscriptionTier: 'business', subscriptionStatus: 'active' },
      { subscriptionTier: 'agency', subscriptionStatus: 'trialing' },
      { subscriptionTier: 'starter', subscriptionStatus: 'past_due' },
      { subscriptionTier: 'business', subscriptionStatus: 'canceled' },
    ],
  };
}

describe('computePlatformAnalytics — funnel', () => {
  const a = computePlatformAnalytics(fixture(), NOW);

  it('compte les couples, events créés et publiés', () => {
    expect(a.funnel.couplesSignedUp).toBe(3);
    expect(a.funnel.eventsCreated).toBe(4);
    expect(a.funnel.eventsPublished).toBe(3); // active + archived
  });

  it('checkoutStarted = events distincts avec ≥1 intent, paid = events distincts payés', () => {
    expect(a.funnel.checkoutStarted).toBe(3); // e1, e2, e3
    expect(a.funnel.paid).toBe(2); // e1, e2
  });
});

describe('computePlatformAnalytics — checkout & abandon', () => {
  const a = computePlatformAnalytics(fixture(), NOW);

  it('répartit les statuts de paiement', () => {
    expect(a.checkout.intentsStarted).toBe(4);
    expect(a.checkout.byStatus).toMatchObject({
      pending: 1,
      succeeded: 2,
      failed: 1,
      cancelled: 0,
      refunded: 0,
    });
  });

  it('taux d’abandon = (intents - réussis) / intents', () => {
    expect(a.checkout.abandonmentRate).toBeCloseTo(0.5, 5); // (4-2)/4
  });

  it('intents=0 → abandon 0 (pas de division par zéro)', () => {
    const empty = computePlatformAnalytics({ users: [], events: [], payments: [], orgs: [] }, NOW);
    expect(empty.checkout.abandonmentRate).toBe(0);
  });
});

describe('computePlatformAnalytics — timing', () => {
  const a = computePlatformAnalytics(fixture(), NOW);

  it('durée de checkout médiane (minutes)', () => {
    expect(a.timing.medianCheckoutMinutes).toBe(20); // médiane de [10, 30]
  });

  it('délai création→paiement médian (heures)', () => {
    // e1: 5j = 120h ; e2: 5j = 120h
    expect(a.timing.medianCreateToPayHours).toBe(120);
  });
});

describe('computePlatformAnalytics — saisonnalité / rush', () => {
  const a = computePlatformAnalytics(fixture(), NOW);

  it('rush à venir (fenêtres 30/60/90 j)', () => {
    expect(a.seasonality.upcoming.next30).toBe(1); // e1 (+20j)
    expect(a.seasonality.upcoming.next60).toBe(2); // e1, e2 (+50j)
    expect(a.seasonality.upcoming.next90).toBe(2); // e3 (+100j) hors fenêtre
  });

  it('eventsByWeekday couvre les 7 jours et somme au nombre d’events', () => {
    expect(a.seasonality.eventsByWeekday).toHaveLength(7);
    expect(a.seasonality.eventsByWeekday.reduce((s, n) => s + n, 0)).toBe(4);
  });

  it('regroupe par mois d’événement et de création', () => {
    const totalEventMonth = Object.values(a.seasonality.eventsByEventMonth).reduce(
      (s, n) => s + n,
      0,
    );
    const totalCreatedMonth = Object.values(a.seasonality.eventsByCreatedMonth).reduce(
      (s, n) => s + n,
      0,
    );
    expect(totalEventMonth).toBe(4);
    expect(totalCreatedMonth).toBe(4);
  });
});

describe('computePlatformAnalytics — mix & valeur', () => {
  const a = computePlatformAnalytics(fixture(), NOW);

  it('mix des plans particuliers', () => {
    expect(a.mix.planMix).toEqual({ essential: 1, premium: 2 });
  });

  it('mix des tiers pro (tous statuts)', () => {
    expect(a.mix.proTierMix).toEqual({ starter: 2, business: 2, agency: 1, comped: 0 });
  });

  it('un compte OFFERT ne se compte ni dans le mix ni dans le MRR', () => {
    // Un cadeau porte forcément un `subscriptionTier` — sans lui son quota
    // d'événements serait illimité — mais ce n'est pas un client. Le laisser
    // dans le mix ferait lire un partenariat comme une vente, et un revenu
    // fantôme dans le MRR est l'erreur qu'on ne voit jamais passer.
    const base = fixture();
    const withComp = computePlatformAnalytics(
      {
        ...base,
        orgs: [
          ...base.orgs,
          {
            subscriptionTier: 'starter',
            compedSubscription: { expiresAt: NOW + 30 * 24 * 60 * 60 * 1000 },
          },
        ],
      },
      NOW,
    );
    expect(withComp.mix.proTierMix.starter).toBe(a.mix.proTierMix.starter);
    expect(withComp.mix.proTierMix.comped).toBe(1);
    expect(withComp.subscriptions.mrrByTierMinor).toEqual(a.subscriptions.mrrByTierMinor);
  });

  it('panier moyen et invités moyens', () => {
    expect(a.mix.aovMinor).toBe(4400); // (5900 + 2900) / 2
    expect(a.mix.avgGuests).toBe(125); // (100+200+150+50)/4
  });
});

describe('computePlatformAnalytics — tendance 30j & abonnements', () => {
  const a = computePlatformAnalytics(fixture(), NOW);

  it('ventes & revenus 30j vs 30j précédents', () => {
    expect(a.trend.paidLast30).toBe(1);
    expect(a.trend.revenueLast30Minor).toBe(5900);
    expect(a.trend.paidPrev30).toBe(1);
    expect(a.trend.revenuePrev30Minor).toBe(2900);
  });

  it('nouveaux events 30j vs 30j précédents', () => {
    expect(a.trend.newEventsLast30).toBe(2); // e1 (-10j), e3 (-5j)
    expect(a.trend.newEventsPrev30).toBe(1); // e2 (-50j)
  });

  it('abonnements par statut + MRR par tier (trialing inclus, past_due/canceled exclus)', () => {
    expect(a.subscriptions.byStatus).toMatchObject({
      active: 2,
      trialing: 1,
      past_due: 1,
      canceled: 1,
      unpaid: 0,
    });
    expect(a.subscriptions.mrrByTierMinor).toEqual({
      starter: 9900,
      business: 21900,
      agency: 44900,
    });
  });
});

describe('median', () => {
  it('vide → 0', () => expect(median([])).toBe(0));
  it('impair → élément central', () => expect(median([3, 1, 2])).toBe(2));
  it('pair → moyenne des deux centraux', () => expect(median([10, 30])).toBe(20));
  it('ne mute pas l’entrée', () => {
    const arr = [3, 1, 2];
    median(arr);
    expect(arr).toEqual([3, 1, 2]);
  });
});

describe('computeRefundOutcome', () => {
  it('remboursement total', () => {
    expect(computeRefundOutcome(5900, 0, 5900)).toEqual({
      status: 'refunded',
      totalRefunded: 5900,
    });
  });
  it('remboursement partiel', () => {
    expect(computeRefundOutcome(5900, 0, 2000)).toEqual({
      status: 'partially_refunded',
      totalRefunded: 2000,
    });
  });
  it('partiel cumulé jusqu’au total → refunded', () => {
    expect(computeRefundOutcome(5900, 2000, 3900)).toEqual({
      status: 'refunded',
      totalRefunded: 5900,
    });
  });
  it('dépassement du montant → throw', () => {
    expect(() => computeRefundOutcome(5900, 2000, 4000)).toThrow('REFUND_EXCEEDS_AMOUNT');
    expect(() => computeRefundOutcome(5900, 0, 5901)).toThrow('REFUND_EXCEEDS_AMOUNT');
  });
});
