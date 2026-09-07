import { describe, expect, it } from 'vitest';
import {
  PARTNER_CODE_VALIDITY_DAYS,
  partnerCouponPlan,
  shouldCreatePartnerCoupon,
} from '../../../lib/payments/affiliate-coupon';
import { STRIPE_COUPON_NAME_MAX_LENGTH, couponNameLength } from '../../../lib/payments/coupon-name';
import { MAX_COMBINED_BPS } from '../../../convex/lib/affiliate';

const NOW = Date.UTC(2026, 8, 6);
const DAY = 24 * 60 * 60 * 1000;

describe('shouldCreatePartnerCoupon', () => {
  it('crée un code dès qu’une remise filleul est configurée', () => {
    expect(shouldCreatePartnerCoupon(1000)).toBe(true); // -10 %
    expect(shouldCreatePartnerCoupon(500)).toBe(true); // -5 %
    expect(shouldCreatePartnerCoupon(1)).toBe(true); // -0,01 %
  });

  it('refuse sans remise — un code qui ne donne rien n’a rien à faire en story', () => {
    expect(shouldCreatePartnerCoupon(0)).toBe(false);
    expect(shouldCreatePartnerCoupon(-100)).toBe(false);
  });

  it('refuse au-delà de 100 % (borne Stripe) et les bps non entiers', () => {
    expect(shouldCreatePartnerCoupon(10000)).toBe(true); // 100 % pile : accepté
    expect(shouldCreatePartnerCoupon(10001)).toBe(false);
    expect(shouldCreatePartnerCoupon(1000.5)).toBe(false);
    expect(shouldCreatePartnerCoupon(Number.NaN)).toBe(false);
  });

  it('accepte tout ce que le garde-fou marge laisse passer', () => {
    // Le plafond métier (25 % cumulés) doit rester dans le domaine acceptable
    // du coupon, sinon un affilié valide se retrouverait sans code partageable.
    expect(shouldCreatePartnerCoupon(MAX_COMBINED_BPS)).toBe(true);
  });
});

describe('partnerCouponPlan', () => {
  it('convertit les bps en pourcentage Stripe', () => {
    const plan = partnerCouponPlan({ code: 'SARAH', buyerDiscountBps: 1000, now: NOW });
    expect(plan?.percentOff).toBe(10);
  });

  it('gère une remise à décimales sans arrondir en silence', () => {
    // 7,5 % doit rester 7,5 % : promettre un taux et en appliquer un autre
    // serait une trahison de la partenaire vis-à-vis de son audience.
    const plan = partnerCouponPlan({ code: 'SARAH', buyerDiscountBps: 750, now: NOW });
    expect(plan?.percentOff).toBe(7.5);
  });

  it('nomme le coupon avec le nom d’affichage quand il existe', () => {
    const plan = partnerCouponPlan({
      code: 'SARAH',
      buyerDiscountBps: 1000,
      displayName: 'Your Wedding Method',
      now: NOW,
    });
    expect(plan?.name).toBe('SARAH · -10 % · Your Wedding Method');
  });

  it('omet le nom d’affichage quand il est vide — le code parle seul', () => {
    const plan = partnerCouponPlan({
      code: 'SARAH',
      buyerDiscountBps: 1000,
      displayName: '   ',
      now: NOW,
    });
    expect(plan?.name).toBe('SARAH · -10 %');
  });

  it('omet le nom d’affichage quand il redit le code', () => {
    const plan = partnerCouponPlan({
      code: 'SARAH',
      buyerDiscountBps: 1000,
      displayName: 'sarah',
      now: NOW,
    });
    expect(plan?.name).toBe('SARAH · -10 %');
  });

  it('marque le coupon en metadata — le nom seul ne suffit pas à le retrouver', () => {
    const plan = partnerCouponPlan({ code: 'SARAH12', buyerDiscountBps: 1000, now: NOW });
    expect(plan?.metadata).toEqual({
      wedillybird: 'partner_code',
      wedillybird_affiliate_code: 'SARAH12',
    });
  });

  it('borne la validité à un an', () => {
    const plan = partnerCouponPlan({ code: 'SARAH', buyerDiscountBps: 1000, now: NOW });
    expect(plan?.redeemBy).toBe(NOW + PARTNER_CODE_VALIDITY_DAYS * DAY);
    expect(PARTNER_CODE_VALIDITY_DAYS).toBe(365);
  });

  it('déterministe — même entrée, même plan', () => {
    const a = partnerCouponPlan({ code: 'SARAH', buyerDiscountBps: 1000, now: NOW });
    const b = partnerCouponPlan({ code: 'SARAH', buyerDiscountBps: 1000, now: NOW });
    expect(a).toEqual(b);
  });

  it('rend null sans remise — l’appelant ne crée alors aucun coupon', () => {
    expect(partnerCouponPlan({ code: 'SARAH', buyerDiscountBps: 0, now: NOW })).toBeNull();
  });
});

describe('partnerCouponPlan — limite Stripe de 40 caractères sur `coupon.name`', () => {
  // Régression : Stripe REFUSE (400 « must be at most 40 characters ») au lieu
  // de tronquer, et l'affilié se retrouvait créé sans code partageable.
  it('tient dans la limite avec le nom qui a cassé la création (SARAH12)', () => {
    const plan = partnerCouponPlan({
      code: 'SARAH12',
      buyerDiscountBps: 1000,
      displayName: 'Sarah - Your Wedding Method',
      now: NOW,
    });
    expect(couponNameLength(plan!.name)).toBeLessThanOrEqual(STRIPE_COUPON_NAME_MAX_LENGTH);
    expect(plan?.name).toBe('SARAH12 · -10 % · Sarah - Your Wedding…');
  });

  it('tient dans la limite avec le second cas réel (NORAH10)', () => {
    const plan = partnerCouponPlan({
      code: 'NORAH10',
      buyerDiscountBps: 1000,
      displayName: 'Norah — @norah',
      now: NOW,
    });
    expect(couponNameLength(plan!.name)).toBeLessThanOrEqual(STRIPE_COUPON_NAME_MAX_LENGTH);
    expect(plan?.name).toBe('NORAH10 · -10 % · Norah — @norah');
  });

  it('n’ampute jamais le code ni le taux — c’est eux qui identifient le coupon', () => {
    const plan = partnerCouponPlan({
      code: 'MAXCODE0123456789012345',
      buyerDiscountBps: 1234,
      displayName: 'Un nom d’affichage vraiment très long',
      now: NOW,
    });
    expect(couponNameLength(plan!.name)).toBeLessThanOrEqual(STRIPE_COUPON_NAME_MAX_LENGTH);
    expect(plan?.name).toContain('MAXCODE0123456789012345');
    expect(plan?.name).toContain('-12.34 %');
  });

  it('signale la coupe par une ellipse plutôt que de faire passer un nom tronqué pour complet', () => {
    const plan = partnerCouponPlan({
      code: 'SARAH12',
      buyerDiscountBps: 1000,
      displayName: 'Sarah - Your Wedding Method',
      now: NOW,
    });
    expect(plan?.name.endsWith('…')).toBe(true);
  });

  it('reste dans la limite pour toute la combinatoire code × remise × nom', () => {
    const codes = ['ABC', 'SARAH', 'NORAH10', 'MAXCODE0123456789012345'];
    const discounts = [1, 250, 1000, 1234, 2500, 10000];
    const names = [
      undefined,
      '',
      'Norah — @norah',
      'Sarah - Your Wedding Method',
      '🎀 Une partenaire au nom interminable et plein d’émojis 🎀',
    ];
    for (const code of codes) {
      for (const buyerDiscountBps of discounts) {
        for (const displayName of names) {
          const plan = partnerCouponPlan({ code, buyerDiscountBps, displayName, now: NOW });
          expect(couponNameLength(plan!.name)).toBeLessThanOrEqual(STRIPE_COUPON_NAME_MAX_LENGTH);
        }
      }
    }
  });
});
