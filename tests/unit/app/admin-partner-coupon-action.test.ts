import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `createPartnerCouponForAffiliate` — le chemin exact qui a laissé des
 * partenaires sans code partageable.
 *
 * Il enchaîne quatre appels Stripe et une mutation Convex, et chaque marche
 * a sa façon de mal tomber : un nom refusé, un code déjà pris, un coupon créé
 * dont le code promo échoue, un état à moitié écrit entre Stripe et Convex.
 * Rien de tout cela n'était couvert.
 */

const stripe = {
  findPromotionCodeByCode: vi.fn(),
  retrieveCoupon: vi.fn(),
  resolveConsumerPlanProductIds: vi.fn(),
  createCoupon: vi.fn(),
  createPromotionCode: vi.fn(),
  deleteCoupon: vi.fn(),
};

const convexQuery = vi.fn();
const convexMutation = vi.fn();

vi.mock('@/lib/payments/drivers/stripe', () => stripe);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(async () => ({ userId: 'admin_1' })),
}));
vi.mock('@/lib/auth/convex-server', () => ({
  getConvexServerClient: () => ({ query: convexQuery, mutation: convexMutation }),
  convexApi: new Proxy({}, { get: (_t, k) => String(k) }),
}));

const AFFILIATE = {
  id: 'aff_1',
  code: 'SARAH12',
  buyerDiscountBps: 1000,
  displayName: 'Sarah - Your Wedding Method',
  stripePromotionCodeId: null as string | null,
};

async function ensureCoupon() {
  const mod = await import('@/app/[locale]/(app)/admin/actions');
  return mod.adminEnsureAffiliateCouponAction('aff_1');
}

beforeEach(() => {
  vi.resetModules();
  for (const fn of Object.values(stripe)) fn.mockReset();
  convexQuery.mockReset();
  convexMutation.mockReset();
  // `requireAdmin` puis `getAffiliateForAdmin` : même client, deux réponses.
  convexQuery.mockImplementation(async (name: string) =>
    name === 'currentUser' ? { role: 'admin' } : { ...AFFILIATE },
  );
  convexMutation.mockResolvedValue({});
  stripe.findPromotionCodeByCode.mockResolvedValue(null);
  stripe.resolveConsumerPlanProductIds.mockResolvedValue(['prod_essential', 'prod_premium']);
  stripe.createCoupon.mockResolvedValue({ id: 'coup_1' });
  stripe.createPromotionCode.mockResolvedValue({ id: 'promo_1', code: 'SARAH12' });
});

describe('création du code partenaire', () => {
  it('crée un coupon restreint aux forfaits couple, puis le code promo, puis enregistre les ids', async () => {
    expect(await ensureCoupon()).toEqual({ ok: true });

    const coupon = stripe.createCoupon.mock.calls[0]![0];
    expect(coupon).toMatchObject({
      percentOff: 10,
      duration: 'once',
      // La restriction produit est IMMUABLE côté Stripe : sans elle, le code
      // d'une créatrice remiserait aussi un abonnement pro.
      appliesToProducts: ['prod_essential', 'prod_premium'],
      metadata: { wedillybird: 'partner_code', wedillybird_affiliate_code: 'SARAH12' },
    });
    expect(Array.from(coupon.name as string).length).toBeLessThanOrEqual(40);

    // Le code promo porte EXACTEMENT la chaîne de l'affilié : c'est ce qui
    // permet à `markSucceeded` de remonter du code vers l'affilié.
    expect(stripe.createPromotionCode).toHaveBeenCalledWith(
      expect.objectContaining({ couponId: 'coup_1', code: 'SARAH12' }),
    );
    expect(convexMutation).toHaveBeenCalledWith(
      'setAffiliateStripeCoupon',
      expect.objectContaining({ stripeCouponId: 'coup_1', stripePromotionCodeId: 'promo_1' }),
    );
  });

  it('refuse de créer un coupon sans restriction produit', async () => {
    stripe.resolveConsumerPlanProductIds.mockResolvedValue([]);
    expect(await ensureCoupon()).toEqual({ ok: false, error: 'NO_CONSUMER_PRODUCTS_RESOLVED' });
    expect(stripe.createCoupon).not.toHaveBeenCalled();
  });

  it('ne crée rien quand aucune remise n’est configurée', async () => {
    convexQuery.mockImplementation(async (name: string) =>
      name === 'currentUser' ? { role: 'admin' } : { ...AFFILIATE, buyerDiscountBps: 0 },
    );
    expect(await ensureCoupon()).toEqual({ ok: false, error: 'NO_BUYER_DISCOUNT' });
    expect(stripe.createCoupon).not.toHaveBeenCalled();
  });

  it('supprime le coupon quand le code promo échoue — pas d’orphelin chez Stripe', async () => {
    stripe.createPromotionCode.mockRejectedValue(new Error('code déjà pris'));
    expect(await ensureCoupon()).toEqual({ ok: false, error: 'code déjà pris' });
    expect(stripe.deleteCoupon).toHaveBeenCalledWith('coup_1');
  });
});

/** Le code promo laissé derrière par un échec entre Stripe et Convex. */
function orphanPromo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'promo_orphelin',
    code: 'SARAH12',
    couponId: 'coup_orphelin',
    active: true,
    expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function orphanCoupon(overrides: Record<string, unknown> = {}) {
  return {
    id: 'coup_orphelin',
    percentOff: 10,
    metadata: { wedillybird: 'partner_code', wedillybird_affiliate_code: 'SARAH12' },
    ...overrides,
  };
}

describe('rattrapage d’un état à moitié écrit', () => {
  it('adopte NOTRE code promo laissé derrière au lieu de condamner le partenariat', async () => {
    // Coupon + code créés chez Stripe, ids jamais enregistrés côté Convex :
    // « Créer le code » retombait indéfiniment sur STRIPE_CODE_ALREADY_EXISTS.
    stripe.findPromotionCodeByCode.mockResolvedValue(orphanPromo());
    stripe.retrieveCoupon.mockResolvedValue(orphanCoupon());

    expect(await ensureCoupon()).toEqual({ ok: true });
    expect(stripe.createCoupon).not.toHaveBeenCalled();
    expect(convexMutation).toHaveBeenCalledWith(
      'setAffiliateStripeCoupon',
      expect.objectContaining({
        stripeCouponId: 'coup_orphelin',
        stripePromotionCodeId: 'promo_orphelin',
      }),
    );
  });

  it('refuse d’adopter un code promo qui n’est pas le nôtre', async () => {
    // Un vrai conflit : deux codes de même chaîne rendraient l'attribution
    // ambiguë. On refuse plutôt que de créditer au hasard.
    stripe.findPromotionCodeByCode.mockResolvedValue({
      id: 'promo_autre',
      code: 'SARAH12',
      couponId: 'coup_autre',
    });
    stripe.retrieveCoupon.mockResolvedValue({ id: 'coup_autre', metadata: {} });

    expect(await ensureCoupon()).toEqual({ ok: false, error: 'STRIPE_CODE_ALREADY_EXISTS' });
    expect(convexMutation).not.toHaveBeenCalledWith('setAffiliateStripeCoupon', expect.anything());
  });

  it('n’adopte pas un code désactivé, expiré, ou dont le taux ne colle plus', async () => {
    // Adopter un code que le checkout refusera rendrait `shareable` vrai pour
    // un code mort — et plus rien ne permettrait de le corriger, « Créer le
    // code » retombant dès lors sur CODE_ALREADY_CREATED. On renvoie l'admin
    // au Dashboard Stripe, seul endroit où l'état se répare.
    for (const [label, promo, coupon] of [
      ['désactivé', orphanPromo({ active: false }), orphanCoupon()],
      ['expiré', orphanPromo({ expiresAt: Date.now() - 1000 }), orphanCoupon()],
      ['taux obsolète', orphanPromo(), orphanCoupon({ percentOff: 5 })],
    ] as const) {
      stripe.findPromotionCodeByCode.mockResolvedValue(promo);
      stripe.retrieveCoupon.mockResolvedValue(coupon);
      expect(await ensureCoupon(), label).toEqual({ ok: false, error: 'STRIPE_CODE_STALE' });
    }
    expect(convexMutation).not.toHaveBeenCalledWith('setAffiliateStripeCoupon', expect.anything());
  });

  it('ne recrée pas un code déjà enregistré', async () => {
    convexQuery.mockImplementation(async (name: string) =>
      name === 'currentUser'
        ? { role: 'admin' }
        : { ...AFFILIATE, stripePromotionCodeId: 'promo_1' },
    );
    expect(await ensureCoupon()).toEqual({ ok: false, error: 'CODE_ALREADY_CREATED' });
    expect(stripe.createCoupon).not.toHaveBeenCalled();
  });
});
