import { describe, expect, it } from 'vitest';
import {
  STRIPE_COUPON_NAME_MAX_LENGTH,
  clampCouponName,
  couponNameLength,
  truncateCouponSegment,
} from '../../../lib/payments/coupon-name';

describe('couponNameLength', () => {
  it('compte les caractères, pas les unités UTF-16', () => {
    // `'🎀'.length` vaut 2 : compter comme JS ferait croire un nom trop long
    // (ou, dans l'autre sens, laisserait passer un nom refusé par Stripe).
    expect(couponNameLength('🎀')).toBe(1);
    expect(couponNameLength('Crédit')).toBe(6);
  });
});

describe('truncateCouponSegment', () => {
  it('laisse intacte une chaîne qui tient', () => {
    expect(truncateCouponSegment('Sarah', 10)).toBe('Sarah');
    expect(truncateCouponSegment('Sarah', 5)).toBe('Sarah');
  });

  it('coupe ellipse comprise — le résultat ne dépasse jamais le budget', () => {
    expect(couponNameLength(truncateCouponSegment('Your Wedding Method', 10))).toBe(10);
    expect(truncateCouponSegment('Your Wedding Method', 10)).toBe('Your Wedd…');
  });

  it('n’abandonne pas une espace avant l’ellipse', () => {
    expect(truncateCouponSegment('Your Wedding Method', 13)).toBe('Your Wedding…');
  });

  it('gère les budgets dégénérés sans planter', () => {
    expect(truncateCouponSegment('Sarah', 0)).toBe('');
    expect(truncateCouponSegment('Sarah', -3)).toBe('');
    expect(truncateCouponSegment('Sarah', 1)).toBe('…');
  });
});

describe('clampCouponName', () => {
  it('garantit la limite Stripe sur n’importe quelle saisie', () => {
    const long = 'Un nom interne saisi à la main beaucoup trop long pour Stripe';
    expect(couponNameLength(clampCouponName(long))).toBe(STRIPE_COUPON_NAME_MAX_LENGTH);
  });

  it('ne touche pas à un nom déjà court', () => {
    expect(clampCouponName('Lancement -20%')).toBe('Lancement -20%');
  });

  it('borne bien à 40 — la valeur attendue par l’API Stripe', () => {
    expect(STRIPE_COUPON_NAME_MAX_LENGTH).toBe(40);
  });
});
