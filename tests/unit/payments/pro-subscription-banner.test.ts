import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { proSubscriptionBanner, orgHasActiveAccess } from '@/lib/payments/entitlements';

/**
 * Le bandeau d'abonnement du cockpit agence ne doit jamais contredire l'accès
 * réel : c'est ce qui faisait lire « Aucun abonnement actif — choisissez un
 * forfait pour débloquer le back-office » à une partenaire dont le compte
 * offert venait précisément de le débloquer.
 */
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const FUTURE = NOW + 181 * 24 * 60 * 60 * 1000;
const PAST = NOW - 1;

describe('proSubscriptionBanner', () => {
  it('compte offert en cours : aucun bandeau', () => {
    // Le cas signalé : tier écrit par le lien partenaire, aucun objet Stripe
    // derrière — donc aucun `subscriptionStatus` à lire.
    expect(
      proSubscriptionBanner(
        { subscriptionTier: 'starter', compedSubscription: { expiresAt: FUTURE } },
        NOW,
      ),
    ).toBe('none');
  });

  it('compte offert expiré : le bandeau revient', () => {
    expect(
      proSubscriptionBanner(
        { subscriptionTier: 'starter', compedSubscription: { expiresAt: PAST } },
        NOW,
      ),
    ).toBe('no_plan');
  });

  it('crédit Pay-as-you-go : aucun bandeau non plus', () => {
    // Elle a payé au moins un événement : son back-office est ouvert, il n'y a
    // rien à « débloquer ».
    expect(proSubscriptionBanner({ subscriptionTier: 'starter', paygCredits: 2 }, NOW)).toBe(
      'none',
    );
    expect(proSubscriptionBanner({ subscriptionTier: 'starter', paygCredits: 0 }, NOW)).toBe(
      'no_plan',
    );
  });

  it('agence fraîchement onboardée : « choisissez un forfait »', () => {
    expect(proSubscriptionBanner({}, NOW)).toBe('no_plan');
    expect(proSubscriptionBanner(null, NOW)).toBe('no_plan');
    expect(proSubscriptionBanner({ subscriptionTier: null, subscriptionStatus: null }, NOW)).toBe(
      'no_plan',
    );
  });

  it('abonnement actif : aucun bandeau', () => {
    expect(
      proSubscriptionBanner({ subscriptionTier: 'business', subscriptionStatus: 'active' }, NOW),
    ).toBe('none');
    expect(
      proSubscriptionBanner({ subscriptionTier: 'business', subscriptionStatus: 'trialing' }, NOW),
    ).toBe('none');
  });

  it('incident de paiement et résiliation restent annoncés', () => {
    expect(
      proSubscriptionBanner({ subscriptionTier: 'starter', subscriptionStatus: 'past_due' }, NOW),
    ).toBe('payment_failed');
    expect(
      proSubscriptionBanner({ subscriptionTier: 'starter', subscriptionStatus: 'unpaid' }, NOW),
    ).toBe('payment_failed');
    expect(
      proSubscriptionBanner({ subscriptionTier: 'starter', subscriptionStatus: 'canceled' }, NOW),
    ).toBe('cancelled');
  });

  it('un incident de paiement prime sur un crédit PAYG restant', () => {
    // `orgHasActiveAccess` dirait « accès » (crédit > 0) : le bandeau doit
    // quand même dire que le prélèvement a échoué, c'est un fait Stripe.
    expect(
      proSubscriptionBanner(
        { subscriptionTier: 'starter', subscriptionStatus: 'past_due', paygCredits: 3 },
        NOW,
      ),
    ).toBe('payment_failed');
  });

  it('ne réclame un forfait que quand le back-office est réellement verrouillé', () => {
    const cases = [
      { subscriptionTier: 'starter' as const, compedSubscription: { expiresAt: FUTURE } },
      { subscriptionTier: 'starter' as const, compedSubscription: { expiresAt: PAST } },
      { subscriptionTier: 'starter' as const, paygCredits: 1 },
      { subscriptionTier: 'starter' as const, paygCredits: 0 },
      { subscriptionTier: null, subscriptionStatus: null },
      {},
    ];
    for (const c of cases) {
      expect(proSubscriptionBanner(c, NOW) === 'no_plan', JSON.stringify(c)).toBe(
        !orgHasActiveAccess(c, NOW),
      );
    }
  });
});

describe('cockpit agence', () => {
  const cockpit = readFileSync('components/pro/cockpit.tsx', 'utf8');

  it('délègue la décision au helper plutôt que de relire Stripe sur place', () => {
    expect(cockpit).toContain('proSubscriptionBanner(');
    expect(cockpit).toContain('compedSubscription={org.compedSubscription ?? null}');
    // L'ancienne règle : le bandeau ne voyait que (tier, statut).
    expect(cockpit).not.toContain(
      "if (tier && (status === 'active' || status === 'trialing')) return null;",
    );
  });
});
