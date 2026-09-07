import { describe, expect, it } from 'vitest';
import { orgHasActiveAccess as appAccess } from '../../../lib/payments/entitlements';
import { orgHasActiveAccess as convexAccess } from '../../../convex/lib/entitlements';

/**
 * Miroir app-side de `orgHasActiveAccess` (sert la bannière « choisir un forfait »
 * et masque les actions de création). Doit rester en phase avec la source de
 * vérité serveur (`convex/lib/entitlements.ts`).
 */
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const FUTURE = NOW + 30 * 24 * 60 * 60 * 1000;
const PAST = NOW - 1;

const CASES = [
  { subscriptionStatus: 'active' as const },
  { subscriptionStatus: 'trialing' as const },
  { subscriptionStatus: 'past_due' as const },
  { subscriptionStatus: 'canceled' as const },
  { subscriptionStatus: 'unpaid' as const },
  { paygCredits: 0 },
  { paygCredits: 4 },
  { subscriptionStatus: 'canceled' as const, paygCredits: 3 },
  { subscriptionStatus: undefined, paygCredits: 0 },
  {},
  // Comptes offerts : la duplication du miroir porte maintenant une
  // comparaison de date, exactement le genre de règle qui dérive en silence
  // entre deux implémentations.
  { compedSubscription: { expiresAt: FUTURE } },
  { compedSubscription: { expiresAt: PAST } },
  { compedSubscription: { expiresAt: NOW } },
  { compedSubscription: null },
  { subscriptionStatus: 'active' as const, compedSubscription: { expiresAt: PAST } },
  { subscriptionStatus: 'canceled' as const, compedSubscription: { expiresAt: FUTURE } },
  { compedSubscription: { expiresAt: PAST }, paygCredits: 1 },
];

describe('orgHasActiveAccess (app-side)', () => {
  it('rend exactement la même vérité que le miroir Convex', () => {
    for (const c of CASES) {
      // Même instant des deux côtés : sans `now` figé, un cas limite exactement
      // à l'échéance tomberait d'un côté et pas de l'autre selon l'horloge.
      expect(appAccess(c, NOW), JSON.stringify(c)).toBe(convexAccess(c, NOW));
    }
  });

  it('active / trialing / crédit → accès', () => {
    expect(appAccess({ subscriptionStatus: 'active' })).toBe(true);
    expect(appAccess({ subscriptionStatus: 'trialing' })).toBe(true);
    expect(appAccess({ paygCredits: 1 })).toBe(true);
  });

  it('null / undefined / canceled sans crédit → pas d’accès', () => {
    expect(appAccess(null)).toBe(false);
    expect(appAccess(undefined)).toBe(false);
    expect(appAccess({ subscriptionStatus: 'canceled' })).toBe(false);
  });

  it('tolère les champs null (forme du retour Convex myOrganization)', () => {
    expect(appAccess({ subscriptionStatus: null, paygCredits: null })).toBe(false);
    expect(appAccess({ subscriptionStatus: 'active', paygCredits: null })).toBe(true);
    expect(appAccess({ subscriptionStatus: null, compedSubscription: null })).toBe(false);
  });

  it('compte offert : accès tant que l’échéance est devant', () => {
    expect(appAccess({ compedSubscription: { expiresAt: FUTURE } }, NOW)).toBe(true);
    expect(appAccess({ compedSubscription: { expiresAt: PAST } }, NOW)).toBe(false);
  });
});
