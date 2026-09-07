import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { eventNeedsConsumerPlan } from '@/lib/payments/entitlements';

describe('eventNeedsConsumerPlan', () => {
  it("ne propose pas de forfait particulier sur un mariage d'agence", () => {
    // Le cas signalé : une partenaire à qui l'on vient d'offrir six mois créait
    // son premier mariage et se voyait proposer de payer 29 € ou 59 €.
    expect(eventNeedsConsumerPlan({ organizationId: 'org_1' })).toBe(false);
    // Vrai même si l'event n'a aucun planTier — c'est justement le cas normal
    // pour une agence : sa couverture vit sur l'organisation, pas sur l'event.
    expect(eventNeedsConsumerPlan({ organizationId: 'org_1', planTier: null })).toBe(false);
  });

  it('le propose à un particulier sans forfait', () => {
    expect(eventNeedsConsumerPlan({})).toBe(true);
    expect(eventNeedsConsumerPlan({ organizationId: null })).toBe(true);
  });

  it("s'aligne sur ce que fait decidePublishGate", () => {
    // La règle serveur : un event porteur d'organizationId n'a jamais besoin de
    // planTier. L'écran doit dire la même chose que le serveur fait — c'est la
    // divergence entre les deux qui produisait le faux mur payant.
    const gate = readFileSync('convex/events.ts', 'utf8');
    const fn = gate.slice(gate.indexOf('export function decidePublishGate'));
    expect(fn).toContain('if (!event.organizationId) {');
    expect(fn).toContain("return { ok: false as const, error: 'PLAN_REQUIRED' as const };");
  });
});

describe("page de l'événement", () => {
  const page = readFileSync('app/[locale]/(app)/events/[eventId]/page.tsx', 'utf8');

  it('conditionne la section forfait à la règle, sans la réécrire sur place', () => {
    expect(page).toContain('eventNeedsConsumerPlan(event)');
    // Le rendu inconditionnel était le défaut : la carte s'affichait pour tout
    // le monde, agences comprises.
    expect(page).not.toMatch(/const upgradeSection = \(\s*\n\s*<div id="upgrade"/);
  });

  it("ne laisse pas le badge pointer vers une ancre qui n'existe plus", () => {
    // `#upgrade` disparaît avec la section : le badge doit cesser d'y mener.
    expect(page).toContain('if (!tier && !coveredByOrganization) {');
  });
});
