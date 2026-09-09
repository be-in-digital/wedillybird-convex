import { describe, expect, it } from 'vitest';
import { decidePartnerComp } from '../../../convex/lib/partnerInvite';

/**
 * Ouverture du compte offert d'une partenaire.
 *
 * Un partenaire ne choisit pas de forfait et ne paie pas : le compte offert est
 * la contrepartie du partenariat. Mais c'est une décision d'argent — poser un
 * cadeau sur une organisation cliente la sortirait du MRR, et prolonger un
 * cadeau qui court le rendrait perpétuel. Ces tests figent les trois issues.
 *
 * Le tier et la durée offerts ne sont PAS testés ici : ce sont des paramètres
 * commerciaux, figés par `partner-invite.test.ts` à côté de leur définition.
 * Les redoubler ici les ferait diverger le jour où le produit les change.
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
    // Re-rattacher un affilié ne doit pas relancer le compteur en silence.
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
