import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { galleryAccessFor } from '@/lib/payments/entitlements';
import { galleryAccessFor as convexGalleryAccessFor } from '../../../convex/lib/entitlements';

const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const ORG_EVENT = { organizationId: 'org_1' };

describe('galleryAccessFor — particulier', () => {
  it("verrouille tant que le forfait n'est pas acheté", () => {
    expect(galleryAccessFor({}, null, NOW)).toBe('locked');
    expect(galleryAccessFor({ galleryExpiresAt: null }, null, NOW)).toBe('locked');
  });

  it('ouvre pendant la rétention achetée, ferme après', () => {
    expect(galleryAccessFor({ galleryExpiresAt: NOW + DAY }, null, NOW)).toBe('open');
    expect(galleryAccessFor({ galleryExpiresAt: NOW - DAY }, null, NOW)).toBe('expired');
  });
});

describe('galleryAccessFor — agence', () => {
  it("ouvre tant que l'organisation est couverte", () => {
    expect(galleryAccessFor(ORG_EVENT, { subscriptionStatus: 'active' }, NOW)).toBe('open');
    expect(galleryAccessFor(ORG_EVENT, { subscriptionStatus: 'trialing' }, NOW)).toBe('open');
    expect(galleryAccessFor(ORG_EVENT, { compedSubscription: { expiresAt: NOW + DAY } }, NOW)).toBe(
      'open',
    );
    expect(galleryAccessFor(ORG_EVENT, { paygCredits: 1 }, NOW)).toBe('open');
  });

  it('ferme quand la couverture tombe', () => {
    expect(galleryAccessFor(ORG_EVENT, { subscriptionStatus: 'canceled' }, NOW)).toBe('expired');
    expect(galleryAccessFor(ORG_EVENT, null, NOW)).toBe('expired');
  });

  it('un cadeau qui vient d’expirer laisse un sursis en lecture seule', () => {
    // Il s'éteint sans prévenir : fermer d'un coup priverait les couples de
    // photos déjà livrées. Le détail du sursis vit dans `gallery-grace.test.ts`.
    expect(galleryAccessFor(ORG_EVENT, { compedSubscription: { expiresAt: NOW - DAY } }, NOW)).toBe(
      'grace',
    );
    expect(
      galleryAccessFor(ORG_EVENT, { compedSubscription: { expiresAt: NOW - 400 * DAY } }, NOW),
    ).toBe('expired');
  });

  it("ignore galleryExpiresAt : ce n'est pas ce qui la gouverne", () => {
    // C'est tout l'objet du choix « durée de l'abonnement ». Une date figée
    // sur l'event fermerait la galerie à la fin de la période en cours alors
    // que l'agence continue de payer, et un renouvellement n'irait jamais
    // rouvrir les mariages déjà créés.
    const stale = { organizationId: 'org_1', galleryExpiresAt: NOW - 400 * DAY };
    expect(galleryAccessFor(stale, { subscriptionStatus: 'active' }, NOW)).toBe('open');
    const future = { organizationId: 'org_1', galleryExpiresAt: NOW + 400 * DAY };
    expect(galleryAccessFor(future, { subscriptionStatus: 'canceled' }, NOW)).toBe('expired');
  });

  it("un mariage d'agence n'est jamais « locked »", () => {
    // `locked` veut dire « il reste un forfait à acheter pour cet événement ».
    // Pour une agence il n'y en a pas : il y a un abonnement à reprendre, et
    // le message doit envoyer vers la facturation agence.
    for (const org of [null, { subscriptionStatus: 'past_due' as const }, { paygCredits: 0 }]) {
      expect(galleryAccessFor(ORG_EVENT, org, NOW)).not.toBe('locked');
    }
  });
});

describe('miroir Convex', () => {
  it('les deux copies décident pareil', () => {
    const events = [
      {},
      { galleryExpiresAt: NOW + DAY },
      { galleryExpiresAt: NOW - DAY },
      ORG_EVENT,
      { organizationId: 'org_1', galleryExpiresAt: NOW - 400 * DAY },
    ];
    const orgs = [
      null,
      { subscriptionStatus: 'active' as const },
      { subscriptionStatus: 'canceled' as const },
      { compedSubscription: { expiresAt: NOW + DAY } },
      { compedSubscription: { expiresAt: NOW - DAY } },
      { paygCredits: 2 },
    ];
    for (const event of events) {
      for (const org of orgs) {
        expect(convexGalleryAccessFor(event, org, NOW)).toBe(galleryAccessFor(event, org, NOW));
      }
    }
  });
});

describe('garde serveur des uploads', () => {
  it("charge bien l'organisation avant de décider", () => {
    // Le défaut d'origine : `assertGalleryOpen` ne regardait que l'event, donc
    // AUCUNE agence ne pouvait déposer de photo — `galleryExpiresAt` n'est
    // jamais écrit pour un event d'organisation.
    const src = readFileSync('convex/photos.ts', 'utf8');
    const fn = src.slice(src.indexOf('async function assertGalleryOpen'), src.indexOf('/* ---'));
    expect(fn).toContain('event.organizationId ? await ctx.db.get(event.organizationId) : null');
    expect(fn).toContain('galleryAccessFor(event, org)');
  });
});
