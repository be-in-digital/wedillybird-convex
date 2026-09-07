import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARTNER_COMP_MONTHS,
  DEFAULT_PARTNER_COMP_TIER,
  compExpiresAt,
  decidePartnerComp,
} from '../../../convex/lib/partnerInvite';

/**
 * Ouverture du compte offert d'une partenaire.
 *
 * Un partenaire ne choisit pas de forfait et ne paie pas : le cadeau six mois
 * est la contrepartie du partenariat. Mais c'est une décision d'argent — poser
 * un cadeau sur une organisation cliente la sortirait du MRR, et prolonger un
 * cadeau qui court le rendrait perpétuel. Ces tests figent les trois issues.
 */

const NOW = Date.UTC(2026, 8, 7);

describe('decidePartnerComp', () => {
  it('ouvre le compte quand la partenaire n’a pas encore d’organisation', () => {
    expect(decidePartnerComp({ org: null, now: NOW })).toEqual({ action: 'grant' });
    expect(decidePartnerComp({ now: NOW })).toEqual({ action: 'grant' });
  });

  it('ouvre le compte pour une organisation sans abonnement ni cadeau', () => {
    expect(decidePartnerComp({ org: {}, now: NOW })).toEqual({ action: 'grant' });
  });

  it('refuse d’offrir à une organisation cliente — elle sortirait du MRR', () => {
    expect(decidePartnerComp({ org: { stripeSubscriptionId: 'sub_123' }, now: NOW })).toEqual({
      action: 'refuse',
      reason: 'org_subscribed',
    });
  });

  it('le refus prime sur tout : cliente ET déjà comped reste un refus', () => {
    // Sinon un re-rattachement écraserait l'abonnement d'une cliente payante.
    expect(
      decidePartnerComp({
        org: { stripeSubscriptionId: 'sub_123', compedSubscription: { expiresAt: NOW + 1 } },
        now: NOW,
      }),
    ).toEqual({ action: 'refuse', reason: 'org_subscribed' });
  });

  it('ne prolonge pas un cadeau qui court encore', () => {
    // Re-rattacher un affilié ne doit pas relancer six mois en silence.
    expect(
      decidePartnerComp({ org: { compedSubscription: { expiresAt: NOW + 1 } }, now: NOW }),
    ).toEqual({ action: 'skip', reason: 'already_comped' });
  });

  it('rouvre un cadeau expiré — renouvellement décidé par l’admin qui rattache', () => {
    expect(
      decidePartnerComp({ org: { compedSubscription: { expiresAt: NOW - 1 } }, now: NOW }),
    ).toEqual({ action: 'grant' });
  });

  it('un cadeau expirant exactement maintenant est expiré, pas actif', () => {
    // `expiresAt > now` strict : sur la frontière, on rouvre plutôt que de
    // laisser la partenaire sans accès une fraction de seconde.
    expect(
      decidePartnerComp({ org: { compedSubscription: { expiresAt: NOW } }, now: NOW }),
    ).toEqual({ action: 'grant' });
  });
});

describe('paramètres du cadeau', () => {
  it('offre six mois', () => {
    expect(DEFAULT_PARTNER_COMP_MONTHS).toBe(6);
  });

  it('reste plafonné à Starter — assez pour tester, trop peu pour exploiter', () => {
    // Plafond commercial délibéré : le relever, c'est offrir 20 ou 50 mariages.
    expect(DEFAULT_PARTNER_COMP_TIER).toBe('starter');
  });

  it('l’échéance tombe six mois après l’ouverture', () => {
    const granted = Date.UTC(2026, 8, 7);
    expect(compExpiresAt(granted, DEFAULT_PARTNER_COMP_MONTHS)).toBe(Date.UTC(2027, 2, 7));
  });
});
