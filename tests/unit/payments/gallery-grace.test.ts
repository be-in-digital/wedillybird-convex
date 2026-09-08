import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GALLERY_GRACE_DAYS,
  galleryAccessFor,
  galleryGraceDaysLeft,
  orgHasActiveAccess,
  withinGalleryGrace,
} from '@/lib/payments/entitlements';
import {
  GALLERY_GRACE_DAYS as CONVEX_GRACE_DAYS,
  galleryAccessFor as convexGalleryAccessFor,
  withinGalleryGrace as convexWithinGrace,
} from '../../../convex/lib/entitlements';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const ORG_EVENT = { organizationId: 'org_1' };

/**
 * Un compte offert expire en SILENCE : aucun objet Stripe derrière, donc aucune
 * relance. Le jour de l'échéance, toutes les galeries de l'agence se fermaient
 * d'un coup — y compris celles de mariages déjà livrés. Ce ne sont pas les
 * photos de l'agence qui disparaissaient, ce sont celles de ses couples.
 */
describe('sursis des galeries après un compte offert', () => {
  const comped = (expiresAt: number) => ({ compedSubscription: { expiresAt } });

  it('cadeau en cours : galerie ouverte, pas en sursis', () => {
    const org = comped(NOW + DAY);
    expect(galleryAccessFor(ORG_EVENT, org, NOW)).toBe('open');
    expect(withinGalleryGrace(org, NOW)).toBe(false);
  });

  it('lendemain de l’échéance : la galerie reste consultable', () => {
    const org = comped(NOW - DAY);
    expect(galleryAccessFor(ORG_EVENT, org, NOW)).toBe('grace');
  });

  it('dernier jour du sursis : encore consultable', () => {
    expect(galleryAccessFor(ORG_EVENT, comped(NOW - GALLERY_GRACE_DAYS * DAY + 1), NOW)).toBe(
      'grace',
    );
  });

  it('au-delà du sursis : fermée', () => {
    expect(galleryAccessFor(ORG_EVENT, comped(NOW - (GALLERY_GRACE_DAYS + 1) * DAY), NOW)).toBe(
      'expired',
    );
  });

  it("le sursis n'ouvre JAMAIS le back-office", () => {
    // C'est la garantie qui rend le sursis acceptable : les couples récupèrent
    // leurs photos, l'agence ne récupère pas le produit.
    const org = comped(NOW - DAY);
    expect(withinGalleryGrace(org, NOW)).toBe(true);
    expect(orgHasActiveAccess(org, NOW)).toBe(false);
  });

  it('un abonnement résilié n’ouvre pas de sursis', () => {
    // Une résiliation a été décidée par quelqu'un, après les relances Stripe :
    // le préavis a déjà eu lieu. Le cadeau, lui, s'éteint sans prévenir.
    const org = { subscriptionStatus: 'canceled' as const };
    expect(withinGalleryGrace(org, NOW)).toBe(false);
    expect(galleryAccessFor(ORG_EVENT, org, NOW)).toBe('expired');
  });

  it('un mariage de particulier n’est pas concerné', () => {
    // Sa rétention est achetée, figée sur l'event — rien à voir avec l'agence.
    expect(galleryAccessFor({ galleryExpiresAt: NOW - DAY }, comped(NOW - DAY), NOW)).toBe(
      'expired',
    );
  });

  it('le décompte annonce des jours entiers, jamais zéro pendant le sursis', () => {
    expect(galleryGraceDaysLeft(comped(NOW - DAY), NOW)).toBe(GALLERY_GRACE_DAYS - 1);
    // Quelques heures restantes = « 1 jour », pas « 0 ».
    expect(galleryGraceDaysLeft(comped(NOW - GALLERY_GRACE_DAYS * DAY + 3 * 3600_000), NOW)).toBe(
      1,
    );
    expect(galleryGraceDaysLeft({ subscriptionStatus: 'active' }, NOW)).toBe(0);
  });
});

/**
 * Le bundler Convex ne suit pas les imports de `lib/` : la règle existe en
 * double. Deux implémentations d'une même date dérivent en silence — celle-ci
 * dirait « encore consultable » quand celle-là a déjà fermé.
 */
describe('miroir app-side / Convex', () => {
  const CASES = [
    { compedSubscription: { expiresAt: NOW + DAY } },
    { compedSubscription: { expiresAt: NOW - DAY } },
    { compedSubscription: { expiresAt: NOW - GALLERY_GRACE_DAYS * DAY } },
    { compedSubscription: { expiresAt: NOW - (GALLERY_GRACE_DAYS + 1) * DAY } },
    { subscriptionStatus: 'active' as const },
    { subscriptionStatus: 'canceled' as const },
    { paygCredits: 1 },
    {},
  ];

  it('la durée du sursis est la même des deux côtés', () => {
    expect(GALLERY_GRACE_DAYS).toBe(CONVEX_GRACE_DAYS);
  });

  it('les deux rendent exactement la même vérité', () => {
    for (const c of CASES) {
      expect(withinGalleryGrace(c, NOW), JSON.stringify(c)).toBe(convexWithinGrace(c, NOW));
      expect(galleryAccessFor(ORG_EVENT, c, NOW), JSON.stringify(c)).toBe(
        convexGalleryAccessFor(ORG_EVENT, c, NOW),
      );
    }
  });
});

describe('le sursis est en LECTURE SEULE', () => {
  it('le dépôt de photos est refusé dès que la galerie n’est plus `open`', () => {
    const photos = readFileSync('convex/photos.ts', 'utf8');
    expect(photos).toContain("if (access !== 'open') throw new Error('GALLERY_EXPIRED');");
  });

  it("l'écran masque le téléversement et annonce l'échéance", () => {
    const page = readFileSync('app/[locale]/(app)/events/[eventId]/gallery/page.tsx', 'utf8');
    expect(page).toContain("readOnly={galleryStatus === 'grace'}");
    expect(page).toContain("t('graceNotice'");
  });
});
