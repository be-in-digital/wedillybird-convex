// @vitest-environment edge-runtime
/**
 * Parcours partenaire de bout en bout, sur les VRAIES fonctions Convex.
 *
 * Ce que les tests unitaires ne pouvaient pas voir : l'enchaînement. Chaque
 * maillon était couvert isolément (calcul de commission, validité d'un code,
 * vesting) mais rien ne vérifiait que la chaîne tient — que le lien
 * d'invitation rattache bien l'affilié, que le rattachement rend `/partenaire`
 * peuplé, que l'achat d'un filleul remonte jusqu'à une commission versable.
 *
 * Le scénario suit la vie réelle d'un partenariat :
 *   admin ouvre l'affilié → code promo Stripe → invitation → la partenaire
 *   accepte → son espace → sa communauté achète → commission → versement.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import {
  newHarness,
  seedAdmin,
  seedEvent,
  seedPendingPayment,
  seedUser,
  WEBHOOK_SECRET,
  type Harness,
} from './utils/convex-harness';

/** Prix Premium EUR, la vente type d'une partenaire « future mariée ». */
const PREMIUM_MINOR = 5900;

let t: Harness;
let adminId: Id<'users'>;

beforeEach(async () => {
  t = newHarness();
  adminId = await seedAdmin(t);
});

/** Ouvre l'affilié comme le fait /admin/affiliates, coupon Stripe compris. */
async function openPartner(
  opts: {
    code?: string;
    rateBps?: number;
    buyerDiscountBps?: number;
    displayName?: string;
    withStripeCode?: boolean;
  } = {},
) {
  const created = await t.mutation(api.affiliate.createAffiliate, {
    adminId,
    code: opts.code ?? 'SARAH12',
    kind: 'partner',
    rewardType: 'cash',
    rateBps: opts.rateBps ?? 1000,
    buyerDiscountBps: opts.buyerDiscountBps ?? 1000,
    displayName: opts.displayName ?? 'Sarah - Your Wedding Method',
  });
  if (opts.withStripeCode !== false) {
    // Ce que fait la server action après avoir créé coupon + code promo Stripe.
    await t.mutation(api.affiliate.setAffiliateStripeCoupon, {
      adminId,
      affiliateId: created.id,
      stripeCouponId: 'coup_test',
      stripePromotionCodeId: 'promo_test',
    });
  }
  return created;
}

/** Achat d'un filleul, confirmé par le webhook. */
async function buyAs(input: {
  buyerId: Id<'users'>;
  sessionId: string;
  affiliateId?: Id<'affiliates'>;
  promotionCode?: string;
  amountMinor?: number;
  netMinor?: number;
  commissionBaseMinor?: number;
  eventDate?: number;
}) {
  const eventId = await seedEvent(t, input.buyerId, { eventDate: input.eventDate });
  await seedPendingPayment(t, {
    userId: input.buyerId,
    eventId,
    amountMinor: input.amountMinor ?? PREMIUM_MINOR,
    sessionId: input.sessionId,
    ...(input.affiliateId ? { affiliateId: input.affiliateId } : {}),
  });
  await t.mutation(api.payments.markSucceeded, {
    webhookSecret: WEBHOOK_SECRET,
    provider: 'stripe',
    providerSessionId: input.sessionId,
    providerEventId: `evt_${input.sessionId}`,
    ...(input.netMinor !== undefined ? { netMinor: input.netMinor } : {}),
    ...(input.commissionBaseMinor !== undefined
      ? { commissionBaseMinor: input.commissionBaseMinor }
      : {}),
    ...(input.promotionCode ? { promotionCode: input.promotionCode } : {}),
  });
  return { eventId };
}

async function referralsOf(affiliateId: Id<'affiliates'>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('affiliateReferrals')
      .withIndex('by_affiliate', (q) => q.eq('affiliateId', affiliateId))
      .collect(),
  );
}

/* ========================================================================== */

describe('Parcours nominal — de l’ouverture du partenariat au versement', () => {
  it('enchaîne invitation → compte agence → espace partenaire → commission → versement', async () => {
    /* 1. L'admin ouvre le partenariat. */
    const affiliate = await openPartner();

    /* 2. Il génère le lien d'invitation « compte agence offert ». */
    const invite = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: affiliate.id,
      inviteeEmail: 'sarah@yourweddingmethod.fr',
      inviteeName: 'Sarah',
      kind: 'pro',
      grantTier: 'business',
      grantMonths: 12,
    });
    expect(invite.token).toHaveLength(24);

    /* 3. Sarah ouvre le lien : la page publique sait quoi lui promettre. */
    const preview = await t.query(api.partnerInvites.getByToken, { token: invite.token });
    expect(preview).toMatchObject({
      state: 'usable',
      kind: 'pro',
      grantTier: 'business',
      grantMonths: 12,
      partnerName: 'Sarah - Your Wedding Method',
      // La moitié « ce que tu partages » du deal : sans code promo Stripe,
      // ce champ serait null et la promesse serait vide.
      partnerCode: 'SARAH12',
    });

    /* 4. Elle crée son compte, puis accepte. */
    const sarahId = await seedUser(t, {
      email: 'sarah@yourweddingmethod.fr',
      fullName: 'Sarah',
      role: 'couple', // rôle par défaut d'une inscription fraîche
    });
    const redeemed = await t.mutation(api.partnerInvites.redeem, {
      token: invite.token,
      userId: sarahId,
      organizationName: 'Your Wedding Method',
    });
    expect(redeemed.kind).toBe('pro');
    expect(redeemed.organizationId).toBeTruthy();
    expect(redeemed.partnerCode).toBe('SARAH12');

    /* 5. Le cadeau est réellement posé, et le compte réellement promu. */
    const { user, org, aff, consumedInvite } = await t.run(async (ctx) => ({
      user: await ctx.db.get(sarahId),
      org: await ctx.db.get(redeemed.organizationId as Id<'organizations'>),
      aff: await ctx.db.get(affiliate.id),
      consumedInvite: await ctx.db
        .query('partnerInvites')
        .withIndex('by_token', (q) => q.eq('token', invite.token))
        .first(),
    }));
    expect(user?.role).toBe('pro');
    expect(org?.subscriptionTier).toBe('business');
    expect(org?.compedSubscription?.tier).toBe('business');
    expect(org?.compedSubscription?.expiresAt).toBeGreaterThan(Date.now());
    // Le rattachement est ce qui rend l'espace partenaire atteignable.
    expect(aff?.ownerUserId).toBe(sarahId);
    expect(consumedInvite?.consumedAt).toBeTruthy();
    expect(consumedInvite?.consumedByUserId).toBe(sarahId);

    /* 6. Son espace existe et annonce un code réellement partageable. */
    const empty = await t.query(api.affiliate.partnerDashboard, { userId: sarahId });
    expect(empty.isPartner).toBe(true);
    expect(empty.codes).toEqual([
      expect.objectContaining({ code: 'SARAH12', shareable: true, status: 'active' }),
    ]);
    expect(empty.salesCount).toBe(0);

    /* 7. Une filleule achète Premium via le LIEN ?ref (affiliateId au checkout). */
    const buyerId = await seedUser(t, { email: 'filleule@test.fr' });
    await buyAs({
      buyerId,
      sessionId: 'cs_link_1',
      affiliateId: affiliate.id,
      // 59 € catalogue, -10 % → 53,10 € encaissés, assiette HT 44,25 €.
      amountMinor: PREMIUM_MINOR,
      netMinor: 5310,
      commissionBaseMinor: 4425,
    });

    /* 8. La commission est au ledger, calculée sur l'assiette HT. */
    const [row] = await referralsOf(affiliate.id);
    expect(row).toMatchObject({
      code: 'SARAH12',
      status: 'pending',
      rewardType: 'cash',
      currency: 'EUR',
      grossMinor: PREMIUM_MINOR,
      netMinor: 5310,
      commissionBaseMinor: 4425,
      // 10 % de 44,25 € = 4,43 €.
      rewardMinor: 443,
    });

    /* 9. Son espace le montre. */
    const withSale = await t.query(api.affiliate.partnerDashboard, { userId: sarahId });
    expect(withSale.salesCount).toBe(1);
    expect(withSale.totals).toEqual([{ currency: 'EUR', status: 'pending', minor: 443 }]);

    /* 10. Le mariage a lieu : la commission s'acquiert. */
    await t.run(async (ctx) => {
      const r = await ctx.db.get(row!._id);
      await ctx.db.patch(r!._id, { vestsAt: Date.now() - 1000 });
    });
    const vested = await t.mutation(internal.affiliate.vestDueReferrals, {});
    expect(vested.vested).toBe(1);

    /* 11. L'admin la marque versée — seule sortie de `vested`. */
    const paid = await t.mutation(api.affiliate.markReferralPaid, {
      adminId,
      referralId: row!._id,
      payoutReference: 'VIR-2026-001',
    });
    expect(paid).toEqual({ outcome: 'settled', status: 'paid' });

    const final = await t.query(api.affiliate.partnerDashboard, { userId: sarahId });
    expect(final.totals).toEqual([{ currency: 'EUR', status: 'paid', minor: 443 }]);
  });
});

describe('Le lien d’invitation, dans tous ses états', () => {
  it('refuse un jeton inconnu, révoqué, expiré ou déjà consommé', async () => {
    const affiliate = await openPartner();
    const sarah = await seedUser(t, { email: 'sarah@test.fr' });

    await expect(
      t.mutation(api.partnerInvites.redeem, {
        token: 'JETON-QUI-NEXISTE-PAS',
        userId: sarah,
        organizationName: 'X',
      }),
    ).rejects.toThrow('INVITE_NOT_FOUND');

    // Révoqué.
    const revoked = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: affiliate.id,
    });
    const revokedId = await t.run(async (ctx) => {
      const inv = await ctx.db
        .query('partnerInvites')
        .withIndex('by_token', (q) => q.eq('token', revoked.token))
        .first();
      return inv!._id;
    });
    await t.mutation(api.partnerInvites.revoke, { adminId, inviteId: revokedId });
    await expect(
      t.mutation(api.partnerInvites.redeem, {
        token: revoked.token,
        userId: sarah,
        organizationName: 'X',
      }),
    ).rejects.toThrow('INVITE_REVOKED');

    // Expiré.
    const expired = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: affiliate.id,
    });
    await t.run(async (ctx) => {
      const inv = await ctx.db
        .query('partnerInvites')
        .withIndex('by_token', (q) => q.eq('token', expired.token))
        .first();
      await ctx.db.patch(inv!._id, { expiresAt: Date.now() - 1000 });
    });
    await expect(
      t.mutation(api.partnerInvites.redeem, {
        token: expired.token,
        userId: sarah,
        organizationName: 'X',
      }),
    ).rejects.toThrow('INVITE_EXPIRED');

    // Consommé : un lien ne sert qu'une fois, même par la même personne.
    const used = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: affiliate.id,
    });
    await t.mutation(api.partnerInvites.redeem, {
      token: used.token,
      userId: sarah,
      organizationName: 'Agence',
    });
    const other = await seedUser(t, { email: 'autre@test.fr' });
    await expect(
      t.mutation(api.partnerInvites.redeem, {
        token: used.token,
        userId: other,
        organizationName: 'Autre',
      }),
    ).rejects.toThrow('INVITE_CONSUMED');
  });

  it('un nouveau lien révoque le précédent — jamais deux comptes offerts', async () => {
    const affiliate = await openPartner();
    const first = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: affiliate.id,
    });
    await t.mutation(api.partnerInvites.create, { adminId, affiliateId: affiliate.id });

    const preview = await t.query(api.partnerInvites.getByToken, { token: first.token });
    expect(preview?.state).toBe('revoked');
  });

  it('refuse un lien porté par un affilié qui n’est pas un partenaire', async () => {
    const referral = await t.mutation(api.affiliate.createAffiliate, {
      adminId,
      code: 'FILLEUL1',
      kind: 'referral',
      rewardType: 'credit',
      rateBps: 2000,
      buyerDiscountBps: 0,
    });
    await expect(
      t.mutation(api.partnerInvites.create, { adminId, affiliateId: referral.id }),
    ).rejects.toThrow('NOT_A_PARTNER_AFFILIATE');
  });

  it('refuse un lien porté par un affilié désactivé', async () => {
    const affiliate = await openPartner();
    await t.mutation(api.affiliate.setAffiliateStatus, {
      adminId,
      affiliateId: affiliate.id,
      status: 'disabled',
    });
    await expect(
      t.mutation(api.partnerInvites.create, { adminId, affiliateId: affiliate.id }),
    ).rejects.toThrow('AFFILIATE_DISABLED');
  });
});

describe('Régressions — les impasses corrigées', () => {
  it('un compte ne peut pas porter deux codes partenaire', async () => {
    // Régression : `redeem` posait `ownerUserId` en direct, sans le contrôle
    // que `setAffiliateOwner` applique. Deux codes sur un compte rendaient
    // l'admin (« détacher ») et le ledger partiellement faux.
    const first = await openPartner({ code: 'SARAH12' });
    const second = await openPartner({ code: 'SARAH34' });
    const sarah = await seedUser(t, { email: 'sarah@test.fr' });

    const inviteA = await t.mutation(api.partnerInvites.create, { adminId, affiliateId: first.id });
    await t.mutation(api.partnerInvites.redeem, {
      token: inviteA.token,
      userId: sarah,
      organizationName: 'Your Wedding Method',
    });

    const inviteB = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: second.id,
    });
    await expect(
      t.mutation(api.partnerInvites.redeem, {
        token: inviteB.token,
        userId: sarah,
        organizationName: 'Your Wedding Method',
      }),
    ).rejects.toThrow('USER_ALREADY_HAS_AFFILIATE');

    const dash = await t.query(api.affiliate.partnerDashboard, { userId: sarah });
    expect(dash.codes).toHaveLength(1);
  });

  it('promeut en pro même quand l’agence existe déjà', async () => {
    // Régression : la promotion de rôle ne vivait que dans la branche
    // « création d'organisation ». Un propriétaire d'agence resté `couple`
    // recevait le cadeau puis était renvoyé au dashboard couple à chaque
    // connexion, sans jamais atteindre son back-office.
    const affiliate = await openPartner();
    const sarah = await seedUser(t, { email: 'sarah@test.fr', role: 'couple' });
    const now = Date.now();
    await t.run(async (ctx) =>
      ctx.db.insert('organizations', {
        ownerId: sarah,
        name: 'Agence déjà là',
        slug: 'agence-deja-la',
        createdAt: now,
        updatedAt: now,
      }),
    );

    const invite = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: affiliate.id,
    });
    await t.mutation(api.partnerInvites.redeem, {
      token: invite.token,
      userId: sarah,
      organizationName: 'Agence déjà là',
    });

    const user = await t.run(async (ctx) => ctx.db.get(sarah));
    expect(user?.role).toBe('pro');
  });

  it('refuse d’adopter une agence qui paie déjà', async () => {
    const affiliate = await openPartner();
    const sarah = await seedUser(t, { email: 'sarah@test.fr' });
    const now = Date.now();
    await t.run(async (ctx) =>
      ctx.db.insert('organizations', {
        ownerId: sarah,
        name: 'Agence cliente',
        slug: 'agence-cliente',
        stripeSubscriptionId: 'sub_live_1',
        createdAt: now,
        updatedAt: now,
      }),
    );
    const invite = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: affiliate.id,
    });
    await expect(
      t.mutation(api.partnerInvites.redeem, {
        token: invite.token,
        userId: sarah,
        organizationName: 'Agence cliente',
      }),
    ).rejects.toThrow('ORG_ALREADY_SUBSCRIBED');
  });

  it('n’écrase pas un forfait particulier déjà offert', async () => {
    // Régression : `redeem` réécrivait `compedEventPlan` sans regarder. Un
    // second lien effaçait un cadeau non encore consommé — un forfait perdu,
    // en silence.
    const affiliate = await openPartner({ code: 'NORAH10' });
    const norah = await seedUser(t, { email: 'norah@test.fr' });
    const granted = Date.now() - 10_000;
    await t.run(async (ctx) =>
      ctx.db.patch(norah, {
        compedEventPlan: {
          tier: 'premium' as const,
          grantedBy: adminId,
          grantedAt: granted,
          reason: 'cadeau antérieur',
        },
      }),
    );

    const invite = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: affiliate.id,
      kind: 'couple',
      grantEventTier: 'essential',
    });
    await t.mutation(api.partnerInvites.redeem, { token: invite.token, userId: norah });

    const user = await t.run(async (ctx) => ctx.db.get(norah));
    expect(user?.compedEventPlan?.tier).toBe('premium');
    expect(user?.compedEventPlan?.grantedAt).toBe(granted);
    // Le lien est bien consommé et le rattachement fait : seul le cadeau est préservé.
    expect(user?.role).toBe('couple');
    const aff = await t.run(async (ctx) => ctx.db.get(affiliate.id));
    expect(aff?.ownerUserId).toBe(norah);
  });

  it('un lien « compte personnel » ne promeut jamais en pro', async () => {
    const affiliate = await openPartner({ code: 'NORAH10' });
    const norah = await seedUser(t, { email: 'norah@test.fr', role: 'couple' });
    const invite = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: affiliate.id,
      kind: 'couple',
      grantEventTier: 'premium',
    });
    const res = await t.mutation(api.partnerInvites.redeem, { token: invite.token, userId: norah });

    expect(res.kind).toBe('couple');
    expect(res.organizationId).toBeNull();
    const user = await t.run(async (ctx) => ctx.db.get(norah));
    expect(user?.role).toBe('couple');
    expect(user?.compedEventPlan?.tier).toBe('premium');
  });

  it('sans code promo Stripe, l’espace partenaire ne promet pas un code inutilisable', async () => {
    // C'est la conséquence directe du bug de création de coupon : la
    // partenaire arrivait sur un « partage ton code » que son audience se
    // serait vu refuser au checkout.
    const affiliate = await openPartner({ code: 'SANSCODE', withStripeCode: false });
    const sarah = await seedUser(t, { email: 'sarah@test.fr' });
    const invite = await t.mutation(api.partnerInvites.create, {
      adminId,
      affiliateId: affiliate.id,
    });

    const preview = await t.query(api.partnerInvites.getByToken, { token: invite.token });
    expect(preview?.partnerCode).toBeNull();

    await t.mutation(api.partnerInvites.redeem, {
      token: invite.token,
      userId: sarah,
      organizationName: 'Agence',
    });
    const dash = await t.query(api.affiliate.partnerDashboard, { userId: sarah });
    expect(dash.codes?.[0]).toMatchObject({ code: 'SANSCODE', shareable: false });
  });

  it('l’espace partenaire n’existe pas pour qui n’est pas partenaire', async () => {
    const someone = await seedUser(t, { email: 'quidam@test.fr' });
    expect(await t.query(api.affiliate.partnerDashboard, { userId: someone })).toEqual({
      isPartner: false,
    });
    expect(await t.query(api.affiliate.isPartner, { userId: someone })).toBe(false);
  });

  it('`isPartner` distingue le partenaire du simple parrain', async () => {
    const affiliate = await openPartner();
    const sarah = await seedUser(t, { email: 'sarah@test.fr' });
    expect(await t.query(api.affiliate.isPartner, { userId: sarah })).toBe(false);

    await t.mutation(api.affiliate.setAffiliateOwner, {
      adminId,
      affiliateId: affiliate.id,
      ownerUserId: sarah,
    });
    expect(await t.query(api.affiliate.isPartner, { userId: sarah })).toBe(true);

    // Un code de parrainage particulier ne donne PAS d'espace partenaire.
    const filleul = await seedUser(t, { email: 'filleul@test.fr' });
    const referral = await t.mutation(api.affiliate.createAffiliate, {
      adminId,
      code: 'WBFILLEUL',
      kind: 'referral',
      rewardType: 'credit',
      rateBps: 2000,
      buyerDiscountBps: 0,
    });
    await t.mutation(api.affiliate.setAffiliateOwner, {
      adminId,
      affiliateId: referral.id,
      ownerUserId: filleul,
    });
    expect(await t.query(api.affiliate.isPartner, { userId: filleul })).toBe(false);
  });
});

describe('Invariants de création d’un affilié', () => {
  it('impose la récompense qui découle de la nature de l’affilié', async () => {
    // Un `partner/credit` produirait des commissions ni versables (ce n'est pas
    // du cash) ni dépensables (l'espace partenaire n'a pas de panier), et un
    // `referral/cash` serait versable mais invisible pour son propriétaire.
    await expect(
      t.mutation(api.affiliate.createAffiliate, {
        adminId,
        code: 'BANCAL1',
        kind: 'partner',
        rewardType: 'credit',
        rateBps: 1000,
        buyerDiscountBps: 0,
      }),
    ).rejects.toThrow('REWARD_TYPE_MISMATCH');

    await expect(
      t.mutation(api.affiliate.createAffiliate, {
        adminId,
        code: 'BANCAL2',
        kind: 'referral',
        rewardType: 'cash',
        rateBps: 1000,
        buyerDiscountBps: 0,
      }),
    ).rejects.toThrow('REWARD_TYPE_MISMATCH');
  });

  it('refuse un code invalide, un doublon, et un cumul qui casse la marge', async () => {
    await expect(
      t.mutation(api.affiliate.createAffiliate, {
        adminId,
        code: 'ab',
        kind: 'partner',
        rewardType: 'cash',
        rateBps: 1000,
        buyerDiscountBps: 0,
      }),
    ).rejects.toThrow('INVALID_CODE');

    await openPartner({ code: 'SARAH12' });
    await expect(openPartner({ code: 'sarah12' })).rejects.toThrow('CODE_ALREADY_EXISTS');

    // 20 % de commission + 10 % de remise = 30 %, au-delà du plafond de 25 %.
    await expect(
      openPartner({ code: 'TROPCHER', rateBps: 2000, buyerDiscountBps: 1000 }),
    ).rejects.toThrow('UNSAFE_REWARD_CONFIG');
  });

  it('refuse la création à qui n’est pas admin', async () => {
    const quidam = await seedUser(t, { email: 'quidam@test.fr' });
    await expect(
      t.mutation(api.affiliate.createAffiliate, {
        adminId: quidam,
        code: 'PIRATE1',
        kind: 'partner',
        rewardType: 'cash',
        rateBps: 1000,
        buyerDiscountBps: 0,
      }),
    ).rejects.toThrow('FORBIDDEN');
  });
});
