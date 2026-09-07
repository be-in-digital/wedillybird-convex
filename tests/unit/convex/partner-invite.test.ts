import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARTNER_COMP_MONTHS,
  DEFAULT_PARTNER_COMP_TIER,
  PARTNER_INVITE_VALIDITY_DAYS,
  addMonthsUtc,
  compDaysRemaining,
  compExpiresAt,
  inviteExpiresAt,
  inviteState,
  isCompActive,
} from '../../../convex/lib/partnerInvite';
import { eventQuotaForTier } from '../../../convex/lib/entitlements';
import {
  compDaysRemaining as appDaysRemaining,
  isCompActive as appIsCompActive,
} from '../../../lib/payments/comped-trial';

describe('addMonthsUtc — mois calendaires, pas 30 jours', () => {
  it('ajoute six mois sans dériver', () => {
    expect(addMonthsUtc(Date.UTC(2026, 8, 7), 6)).toBe(Date.UTC(2027, 2, 7));
  });

  it('ramène au dernier jour valide quand le mois cible est plus court', () => {
    // 31 août + 6 mois → 28 février (2027 n'est pas bissextile).
    expect(addMonthsUtc(Date.UTC(2026, 7, 31), 6)).toBe(Date.UTC(2027, 1, 28));
    // 31 août 2027 + 6 mois → 29 février 2028 (bissextile).
    expect(addMonthsUtc(Date.UTC(2027, 7, 31), 6)).toBe(Date.UTC(2028, 1, 29));
  });

  it('conserve l’heure exacte', () => {
    const from = Date.UTC(2026, 8, 7, 13, 42, 7, 123);
    expect(addMonthsUtc(from, 6)).toBe(Date.UTC(2027, 2, 7, 13, 42, 7, 123));
  });

  it('n’est PAS équivalent à 180 jours', () => {
    // C'est tout l'intérêt : une partenaire à qui l'on promet six mois compte
    // en mois. Selon le mois de départ, l'écart avec un forfait en jours se
    // chiffre en jours entiers.
    const from = Date.UTC(2026, 8, 7);
    const naive = from + 180 * 24 * 60 * 60 * 1000;
    expect(addMonthsUtc(from, 6)).not.toBe(naive);
  });
});

describe('échéances', () => {
  it('le cadeau dure six mois par défaut', () => {
    expect(DEFAULT_PARTNER_COMP_MONTHS).toBe(6);
    const now = Date.UTC(2026, 8, 7);
    expect(compExpiresAt(now)).toBe(addMonthsUtc(now, 6));
  });

  it('le LIEN périme bien avant le compte qu’il ouvre', () => {
    // Deux durées distinctes à dessein : le lien offre six mois à quiconque
    // l'ouvre, il ne doit donc pas traîner aussi longtemps que le cadeau.
    const now = Date.UTC(2026, 8, 7);
    expect(PARTNER_INVITE_VALIDITY_DAYS).toBe(30);
    expect(inviteExpiresAt(now)).toBeLessThan(compExpiresAt(now));
  });
});

describe('isCompActive / compDaysRemaining', () => {
  const NOW = Date.UTC(2026, 8, 7, 12);

  it('actif tant que l’échéance est strictement devant', () => {
    expect(isCompActive({ expiresAt: NOW + 1 }, NOW)).toBe(true);
    expect(isCompActive({ expiresAt: NOW }, NOW)).toBe(false);
    expect(isCompActive({ expiresAt: NOW - 1 }, NOW)).toBe(false);
    expect(isCompActive(null, NOW)).toBe(false);
    expect(isCompActive(undefined, NOW)).toBe(false);
  });

  it('arrondit les jours restants vers le haut', () => {
    const hour = 60 * 60 * 1000;
    // Trois heures restantes, c'est encore « 1 jour » — jamais « 0 jour » sur
    // un compte qui fonctionne toujours.
    expect(compDaysRemaining({ expiresAt: NOW + 3 * hour }, NOW)).toBe(1);
    expect(compDaysRemaining({ expiresAt: NOW + 25 * hour }, NOW)).toBe(2);
    expect(compDaysRemaining({ expiresAt: NOW }, NOW)).toBe(0);
    expect(compDaysRemaining({ expiresAt: NOW - 5 * hour }, NOW)).toBe(0);
    expect(compDaysRemaining(null, NOW)).toBe(0);
  });
});

describe('inviteState — ordre de priorité des raisons', () => {
  const NOW = Date.UTC(2026, 8, 7);
  const FUTURE = NOW + 1000;
  const PAST = NOW - 1000;

  it('utilisable tant qu’il n’a rien subi', () => {
    expect(inviteState({ expiresAt: FUTURE }, NOW)).toBe('usable');
  });

  it('consommé prime sur tout le reste', () => {
    // Un lien utilisé PUIS révoqué reste « consommé » : le compte existe, le
    // cadeau est accordé — l'afficher comme révoqué ferait croire l'inverse.
    expect(inviteState({ consumedAt: PAST, revokedAt: PAST, expiresAt: PAST }, NOW)).toBe(
      'consumed',
    );
  });

  it('révoqué prime sur expiré', () => {
    expect(inviteState({ revokedAt: PAST, expiresAt: PAST }, NOW)).toBe('revoked');
  });

  it('expiré à l’instant exact de l’échéance', () => {
    expect(inviteState({ expiresAt: NOW }, NOW)).toBe('expired');
  });
});

describe('le tier offert est indispensable', () => {
  it('sans tier, le quota d’événements serait ILLIMITÉ', () => {
    // C'est la raison pour laquelle `redeem` écrit `subscriptionTier` sur
    // l'organisation et ne se contente pas du cadeau : ouvrir l'accès sans
    // poser de tier donnerait des mariages sans plafond, l'inverse d'un
    // compte d'essai.
    expect(eventQuotaForTier(undefined)).toBeNull();
    expect(eventQuotaForTier(DEFAULT_PARTNER_COMP_TIER)).toBe(5);
  });

  it('le défaut est le tier le plus bas — tester, pas exploiter', () => {
    expect(DEFAULT_PARTNER_COMP_TIER).toBe('starter');
  });
});

/**
 * Le bundler Convex ne suit pas les imports de `lib/`, donc les helpers du
 * cadeau existent en double : côté serveur (`convex/lib/partnerInvite.ts`) et
 * côté app (`lib/payments/comped-trial.ts`, qui sert la bannière de décompte).
 * Deux implémentations d'une même règle de date dérivent en silence — celle-ci
 * dirait « il reste 1 jour » quand celle-là a déjà fermé l'accès.
 */
describe('miroir app-side du compte offert', () => {
  const NOW = Date.UTC(2026, 8, 7, 12);
  const hour = 60 * 60 * 1000;
  const CASES = [
    null,
    undefined,
    { expiresAt: NOW - 1 },
    { expiresAt: NOW },
    { expiresAt: NOW + 1 },
    { expiresAt: NOW + 3 * hour },
    { expiresAt: NOW + 25 * hour },
    { expiresAt: NOW + 180 * 24 * hour },
  ];

  it('rend exactement la même vérité des deux côtés', () => {
    for (const c of CASES) {
      const label = JSON.stringify(c);
      expect(appIsCompActive(c, NOW), label).toBe(isCompActive(c, NOW));
      expect(appDaysRemaining(c, NOW), label).toBe(compDaysRemaining(c, NOW));
    }
  });
});
