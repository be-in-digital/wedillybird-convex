import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveProTier, tierHasFeature } from '@/lib/payments/entitlements';

/**
 * `subscriptionTier` est une colonne persistante : elle survit à la résiliation
 * comme à l'expiration d'un compte offert. Les gates de fonctionnalités qui la
 * lisaient telle quelle laissaient donc sept modules ouverts à une agence qui
 * n'avait plus rien — inoffensif quand le cadeau valait Starter, une fuite dès
 * qu'il vaut Agency.
 */
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const FUTURE = NOW + 30 * 24 * 60 * 60 * 1000;
const PAST = NOW - 1;

describe('effectiveProTier', () => {
  it('cadeau en cours → le palier offert', () => {
    expect(
      effectiveProTier(
        { subscriptionTier: 'agency', compedSubscription: { expiresAt: FUTURE } },
        NOW,
      ),
    ).toBe('agency');
  });

  it('cadeau expiré → plus aucun palier, malgré la colonne', () => {
    // Le cœur du correctif : sans lui, l'ex-partenaire gardait CRM, devis,
    // contrats, encaissements, analytics et intégrations, gratuitement.
    expect(
      effectiveProTier(
        { subscriptionTier: 'agency', compedSubscription: { expiresAt: PAST } },
        NOW,
      ),
    ).toBeNull();
  });

  it('abonnement résilié → plus aucun palier non plus', () => {
    expect(
      effectiveProTier({ subscriptionTier: 'business', subscriptionStatus: 'canceled' }, NOW),
    ).toBeNull();
  });

  it('abonnement actif ou crédit PAYG → le palier réel', () => {
    expect(
      effectiveProTier({ subscriptionTier: 'business', subscriptionStatus: 'active' }, NOW),
    ).toBe('business');
    expect(effectiveProTier({ subscriptionTier: 'starter', paygCredits: 2 }, NOW)).toBe('starter');
  });

  it('organisation absente → null', () => {
    expect(effectiveProTier(null, NOW)).toBeNull();
    expect(effectiveProTier(undefined, NOW)).toBeNull();
    expect(effectiveProTier({}, NOW)).toBeNull();
  });

  it('aucune fonctionnalité ne survit à la fin de la couverture', () => {
    const expired = effectiveProTier(
      { subscriptionTier: 'agency', compedSubscription: { expiresAt: PAST } },
      NOW,
    );
    for (const feature of [
      'crmPipeline',
      'budgetEditing',
      'documentsEsign',
      'vendorAttach',
      'couplePortal',
      'integrations',
      'analyticsMulti',
      'whiteLabelTotal',
    ] as const) {
      expect(tierHasFeature(expired, feature), feature).toBe(false);
    }
  });
});

/**
 * Le garde-fou vaut ce que vaut son adoption : une page qui relit
 * `org.subscriptionTier` directement rouvre le trou sans bruit.
 */
describe('les écrans pro lisent le palier effectif', () => {
  const PRO_DIR = 'app/[locale]/(app)/pro';

  function pages(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...pages(full));
      else if (entry.name === 'page.tsx') out.push(full);
    }
    return out;
  }

  // La facturation est la seule exception légitime : elle doit montrer le
  // forfait qu'on a eu, même éteint, sinon la carte « abonnement actuel »
  // disparaîtrait au moment précis où l'on vient la consulter.
  const EXCEPTIONS = new Set([join(PRO_DIR, 'billing', 'page.tsx')]);

  it('aucune page ne gate sur la colonne brute', () => {
    const offenders = pages(PRO_DIR)
      .filter((f) => !EXCEPTIONS.has(f))
      .filter((f) => /subscriptionTier \?\? null/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('le cockpit garde le tier brut pour le bandeau, et lui seul', () => {
    // Le bandeau doit distinguer « rien choisi » d'une résiliation ; le reste
    // du cockpit (jauges, bouton CRM, sidebar) suit le palier effectif.
    const cockpit = readFileSync('components/pro/cockpit.tsx', 'utf8');
    expect(cockpit).toContain('const tier = effectiveProTier(org);');
    expect(cockpit).toContain('tier={org.subscriptionTier ?? null}');
  });
});
