import { describe, expect, it } from 'vitest';
import {
  PARTNER_CODE_VALIDITY_DAYS,
  partnerCouponPlan,
  shouldCreatePartnerCoupon,
} from '../../../lib/payments/affiliate-coupon';
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
    expect(plan?.name).toBe('Partenaire Your Wedding Method — SARAH (-10 %)');
  });

  it('retombe sur le code quand le nom d’affichage est vide', () => {
    const plan = partnerCouponPlan({
      code: 'SARAH',
      buyerDiscountBps: 1000,
      displayName: '   ',
      now: NOW,
    });
    expect(plan?.name).toBe('Partenaire SARAH — SARAH (-10 %)');
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
