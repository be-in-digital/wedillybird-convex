// @vitest-environment edge-runtime
/**
 * Attribution et argent : ce qui se passe entre l'achat d'une filleule et la
 * commission de la partenaire.
 *
 * Tout ce chemin vit derrière des `try/catch` best-effort dans `markSucceeded`
 * (la confirmation du paiement prime, à raison). L'effet de bord : une
 * attribution perdue ne remonte nulle part. Ces tests sont donc le seul endroit
 * où l'on vérifie qu'elle ne se perd pas.
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

const DAY = 24 * 60 * 60 * 1000;
/** 59 € catalogue → -10 % = 53,10 € encaissés → assiette HT 44,25 €. */
const CATALOG = 5900;
const NET_AFTER_DISCOUNT = 5310;
const HT_BASE = 4425;

let t: Harness;
let adminId: Id<'users'>;

beforeEach(async () => {
  t = newHarness();
  adminId = await seedAdmin(t);
});

/**
 * Un partenaire tel qu'il existe une fois ouvert : code Stripe compris. Sans
 * lui, son code n'est pas saisissable au checkout — et l'attribution par code
 * tapé n'a alors aucun sens.
 */
async function partner(
  code: string,
  opts: { rateBps?: number; discountBps?: number; withStripeCode?: boolean } = {},
) {
  const created = await t.mutation(api.affiliate.createAffiliate, {
    adminId,
    code,
    kind: 'partner',
    rewardType: 'cash',
    rateBps: opts.rateBps ?? 1000,
    buyerDiscountBps: opts.discountBps ?? 1000,
  });
  if (opts.withStripeCode !== false) {
    await t.mutation(api.affiliate.setAffiliateStripeCoupon, {
      adminId,
      affiliateId: created.id,
      stripeCouponId: `coup_${code}`,
      stripePromotionCodeId: `promo_${code}`,
    });
  }
  return created;
}

async function confirm(input: {
  sessionId: string;
  netMinor?: number;
  commissionBaseMinor?: number;
  promotionCode?: string;
}) {
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
}

async function ledger() {
  return t.run(async (ctx) => ctx.db.query('affiliateReferrals').collect());
}

/* ========================================================================== */

describe('Les deux surfaces d’attribution', () => {
  it('le LIEN ?ref attribue via l’affilié posé au checkout', async () => {
    const aff = await partner('SARAH12');
    const buyer = await seedUser(t, { email: 'filleule@test.fr' });
    const eventId = await seedEvent(t, buyer);
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_link',
      affiliateId: aff.id,
    });

    await confirm({
      sessionId: 'cs_link',
      netMinor: NET_AFTER_DISCOUNT,
      commissionBaseMinor: HT_BASE,
    });

    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'SARAH12', rewardMinor: 443, status: 'pending' });
  });

  it('le CODE TAPÉ attribue quand aucun cookie n’a été posé', async () => {
    const aff = await partner('SARAH12');
    const buyer = await seedUser(t, { email: 'filleule@test.fr' });
    const eventId = await seedEvent(t, buyer);
    const paymentId = await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_typed',
    });

    await confirm({
      sessionId: 'cs_typed',
      netMinor: NET_AFTER_DISCOUNT,
      commissionBaseMinor: HT_BASE,
      promotionCode: 'SARAH12',
    });

    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.affiliateId).toBe(aff.id);
    // Le paiement est rattaché rétroactivement : l'admin voit d'où vient la vente.
    const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
    expect(payment?.affiliateId).toBe(aff.id);
  });

  it('le code tapé l’emporte sur le cookie — c’est lui qui a financé la remise', async () => {
    // Régression : le cookie primait. Quand l'affilié du cookie n'offre aucune
    // remise (tout code de parrainage particulier), le checkout laisse le champ
    // code promo ouvert ; la partenaire dont le code était tapé offrait la
    // remise pendant qu'un tiers encaissait la commission.
    const cookieAff = await t.mutation(api.affiliate.createAffiliate, {
      adminId,
      code: 'WBCOPAIN',
      kind: 'referral',
      rewardType: 'credit',
      rateBps: 2000,
      buyerDiscountBps: 0,
    });
    const typed = await partner('SARAH12');

    const buyer = await seedUser(t, { email: 'filleule@test.fr' });
    const eventId = await seedEvent(t, buyer);
    const paymentId = await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_conflict',
      affiliateId: cookieAff.id,
    });

    await confirm({
      sessionId: 'cs_conflict',
      netMinor: NET_AFTER_DISCOUNT,
      commissionBaseMinor: HT_BASE,
      promotionCode: 'SARAH12',
    });

    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.affiliateId).toBe(typed.id);
    expect(rows[0]?.code).toBe('SARAH12');
    const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
    expect(payment?.affiliateId).toBe(typed.id);
  });

  it('un code de campagne qui se normalise sur un code partenaire ne le crédite pas', async () => {
    // `findActiveAffiliateByCode` normalise en supprimant les caractères non
    // alphanumériques : « SARAH-12 », code de campagne créé au back-office,
    // retombait sur l'affiliée SARAH12. Elle encaissait alors une commission
    // sur une vente qu'elle n'a pas amenée et dont elle n'a pas financé la
    // remise — et le parrain du cookie perdait la sienne.
    const cookieAff = await partner('NORAH10');
    await partner('SARAH12');

    const buyer = await seedUser(t, { email: 'filleule@test.fr' });
    const eventId = await seedEvent(t, buyer);
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_campagne',
      affiliateId: cookieAff.id,
    });

    await confirm({ sessionId: 'cs_campagne', promotionCode: 'SARAH-12' });

    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('NORAH10');
  });

  it('un code partenaire sans code promo Stripe ne détourne pas l’attribution', async () => {
    // Pas de code promo Stripe = code non saisissable au checkout. Une
    // correspondance de chaîne ne suffit donc pas à revendiquer la vente.
    const cookieAff = await partner('NORAH10');
    await partner('SARAH12', { withStripeCode: false });

    const buyer = await seedUser(t, { email: 'filleule@test.fr' });
    const eventId = await seedEvent(t, buyer);
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_fantome',
      affiliateId: cookieAff.id,
    });

    await confirm({ sessionId: 'cs_fantome', promotionCode: 'SARAH12' });
    expect((await ledger())[0]?.code).toBe('NORAH10');
  });

  it('un rejeu avec code promo ne déplace pas l’attribution déjà écrite', async () => {
    // Le ledger est dédoublonné sur la session, pas le patch du paiement :
    // sans garde, un second passage (filet de la page de succès, cron de
    // réconciliation) laissait paiement et ledger crédités à deux affiliés.
    const cookieAff = await partner('NORAH10');
    const typed = await partner('SARAH12');

    const buyer = await seedUser(t, { email: 'filleule@test.fr' });
    const eventId = await seedEvent(t, buyer);
    const paymentId = await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_rejeu',
      affiliateId: cookieAff.id,
    });

    // 1er passage sans code (Stripe n'a pas su le résoudre) → NORAH10.
    await confirm({ sessionId: 'cs_rejeu' });
    expect((await ledger())[0]?.affiliateId).toBe(cookieAff.id);

    // 2e passage AVEC code : le ledger existe déjà, rien ne bouge.
    await confirm({ sessionId: 'cs_rejeu', promotionCode: 'SARAH12' });
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.affiliateId).toBe(cookieAff.id);
    const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
    expect(payment?.affiliateId).toBe(cookieAff.id);
    expect(typed.id).not.toBe(payment?.affiliateId);
  });

  it('un code promo inconnu ou d’un affilié désactivé laisse le cookie en place', async () => {
    const cookieAff = await partner('SARAH12');
    const disabled = await partner('MORTE99');
    await t.mutation(api.affiliate.setAffiliateStatus, {
      adminId,
      affiliateId: disabled.id,
      status: 'disabled',
    });

    const buyer = await seedUser(t, { email: 'filleule@test.fr' });
    const eventId = await seedEvent(t, buyer);
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_ghost',
      affiliateId: cookieAff.id,
    });

    await confirm({ sessionId: 'cs_ghost', promotionCode: 'MORTE99' });

    const rows = await ledger();
    expect(rows[0]?.affiliateId).toBe(cookieAff.id);
  });
});

describe('Le ledger — ce qui doit rester vrai', () => {
  async function sale(sessionId: string, affiliateId: Id<'affiliates'>, eventDate?: number) {
    const buyer = await seedUser(t, { email: `${sessionId}@test.fr` });
    const eventId = await seedEvent(t, buyer, { eventDate });
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId,
      affiliateId,
    });
    await confirm({ sessionId, netMinor: NET_AFTER_DISCOUNT, commissionBaseMinor: HT_BASE });
    return { buyer, eventId };
  }

  it('la commission porte sur l’assiette HT, jamais sur le catalogue', async () => {
    const aff = await partner('SARAH12', { rateBps: 1000 });
    await sale('cs_ht', aff.id);
    const [row] = await ledger();
    // 10 % de 44,25 € = 4,43 € — et non 5,90 € (catalogue) ni 5,31 € (TTC).
    expect(row?.rewardMinor).toBe(443);
    expect(row?.grossMinor).toBe(CATALOG);
    expect(row?.netMinor).toBe(NET_AFTER_DISCOUNT);
    expect(row?.commissionBaseMinor).toBe(HT_BASE);
  });

  it('rejouer le webhook ne crédite pas deux fois', async () => {
    const aff = await partner('SARAH12');
    await sale('cs_replay', aff.id);
    await confirm({
      sessionId: 'cs_replay',
      netMinor: NET_AFTER_DISCOUNT,
      commissionBaseMinor: HT_BASE,
    });
    await confirm({
      sessionId: 'cs_replay',
      netMinor: NET_AFTER_DISCOUNT,
      commissionBaseMinor: HT_BASE,
    });
    expect(await ledger()).toHaveLength(1);
  });

  it('rattache la ligne au paiement source', async () => {
    // Sans `paymentId`, le rapprochement ledger ↔ paiement reposait uniquement
    // sur la chaîne de session Stripe.
    const aff = await partner('SARAH12');
    await sale('cs_payid', aff.id);
    const [row] = await ledger();
    const payment = await t.run(async (ctx) =>
      ctx.db
        .query('payments')
        .withIndex('by_session', (q) =>
          q.eq('provider', 'stripe').eq('providerSessionId', 'cs_payid'),
        )
        .first(),
    );
    expect(row?.paymentId).toBe(payment?._id);
  });

  it('un affilié désactivé ne génère aucune commission', async () => {
    const aff = await partner('SARAH12');
    await t.mutation(api.affiliate.setAffiliateStatus, {
      adminId,
      affiliateId: aff.id,
      status: 'disabled',
    });
    await sale('cs_off', aff.id);
    expect(await ledger()).toHaveLength(0);
  });

  it('bloque l’auto-parrainage, par compte comme par e-mail', async () => {
    const sarah = await seedUser(t, { email: 'sarah@test.fr' });
    const byAccount = await partner('SARAH12');
    await t.mutation(api.affiliate.setAffiliateOwner, {
      adminId,
      affiliateId: byAccount.id,
      ownerUserId: sarah,
    });
    const eventId = await seedEvent(t, sarah);
    await seedPendingPayment(t, {
      userId: sarah,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_self_account',
      affiliateId: byAccount.id,
    });
    await confirm({ sessionId: 'cs_self_account' });
    expect(await ledger()).toHaveLength(0);

    // Même e-mail, compte différent : bloqué aussi.
    const byEmail = await t.mutation(api.affiliate.createAffiliate, {
      adminId,
      code: 'SARAH34',
      kind: 'partner',
      rewardType: 'cash',
      rateBps: 1000,
      buyerDiscountBps: 1000,
      ownerEmail: 'Sarah@Test.FR',
    });
    const sameEmail = await seedUser(t, { email: 'sarah@test.fr' });
    const ev2 = await seedEvent(t, sameEmail);
    await seedPendingPayment(t, {
      userId: sameEmail,
      eventId: ev2,
      amountMinor: CATALOG,
      sessionId: 'cs_self_email',
      affiliateId: byEmail.id,
    });
    await confirm({ sessionId: 'cs_self_email' });
    expect(await ledger()).toHaveLength(0);
  });

  it('acquiert à la date du mariage, avec un plancher à J+7', async () => {
    const aff = await partner('SARAH12');
    // Mariage demain : le plancher J+7 l'emporte, la commission n'est pas due.
    await sale('cs_soon', aff.id, Date.now() + DAY);
    const [row] = await ledger();
    expect(row?.vestsAt).toBeGreaterThan(Date.now() + 6 * DAY);

    expect((await t.mutation(internal.affiliate.vestDueReferrals, {})).vested).toBe(0);

    await t.run(async (ctx) => ctx.db.patch(row!._id, { vestsAt: Date.now() - 1 }));
    expect((await t.mutation(internal.affiliate.vestDueReferrals, {})).vested).toBe(1);
    expect((await t.mutation(internal.affiliate.vestDueReferrals, {})).vested).toBe(0);
  });

  it('un remboursement annule la commission', async () => {
    const aff = await partner('SARAH12');
    await sale('cs_refund', aff.id);
    const payment = await t.run(async (ctx) =>
      ctx.db
        .query('payments')
        .withIndex('by_session', (q) =>
          q.eq('provider', 'stripe').eq('providerSessionId', 'cs_refund'),
        )
        .first(),
    );
    await t.mutation(api.admin.markPaymentRefunded, {
      adminId,
      paymentId: payment!._id,
      refundAmountMinor: CATALOG,
    });
    const [row] = await ledger();
    expect(row?.status).toBe('reversed');
    expect(row?.reversedAt).toBeTruthy();
  });

  it('une commission déjà versée n’est plus reprise', async () => {
    const aff = await partner('SARAH12');
    await sale('cs_paid', aff.id);
    const [row] = await ledger();
    await t.run(async (ctx) => ctx.db.patch(row!._id, { vestsAt: Date.now() - 1 }));
    await t.mutation(internal.affiliate.vestDueReferrals, {});
    await t.mutation(api.affiliate.markReferralPaid, { adminId, referralId: row!._id });

    const payment = await t.run(async (ctx) =>
      ctx.db
        .query('payments')
        .withIndex('by_session', (q) =>
          q.eq('provider', 'stripe').eq('providerSessionId', 'cs_paid'),
        )
        .first(),
    );
    await t.mutation(api.admin.markPaymentRefunded, {
      adminId,
      paymentId: payment!._id,
      refundAmountMinor: CATALOG,
    });
    const [after] = await ledger();
    expect(after?.status).toBe('paid');
  });
});

describe('Versement — ce qui se verse et ce qui ne se verse pas', () => {
  it('verse une commission cash acquise, et une seule fois', async () => {
    const aff = await partner('SARAH12');
    const buyer = await seedUser(t, { email: 'f@test.fr' });
    const eventId = await seedEvent(t, buyer);
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_pay',
      affiliateId: aff.id,
    });
    await confirm({
      sessionId: 'cs_pay',
      netMinor: NET_AFTER_DISCOUNT,
      commissionBaseMinor: HT_BASE,
    });
    const [row] = await ledger();

    // Pas encore acquise : rien à verser.
    expect(
      await t.mutation(api.affiliate.markReferralPaid, { adminId, referralId: row!._id }),
    ).toEqual({ outcome: 'noop', status: 'pending' });

    await t.run(async (ctx) => ctx.db.patch(row!._id, { vestsAt: Date.now() - 1 }));
    await t.mutation(internal.affiliate.vestDueReferrals, {});
    expect(
      await t.mutation(api.affiliate.markReferralPaid, {
        adminId,
        referralId: row!._id,
        payoutReference: 'VIR-1',
      }),
    ).toEqual({ outcome: 'settled', status: 'paid' });
    // Idempotent.
    expect(
      await t.mutation(api.affiliate.markReferralPaid, { adminId, referralId: row!._id }),
    ).toEqual({ outcome: 'noop', status: 'paid' });

    const audit = await t.run(async (ctx) => ctx.db.query('adminAuditLog').collect());
    expect(audit.some((a) => a.action === 'mark_referral_paid')).toBe(true);
  });

  it('refuse de « verser » un crédit — il se dépense, il ne se vire pas', async () => {
    // Régression : marquer versé une ligne `credit` la sortait du solde du
    // parrain sans qu'aucun achat ne l'ait consommée, et sans possibilité de
    // restitution (aucune session consommatrice enregistrée).
    const filleul = await t.mutation(api.affiliate.createAffiliate, {
      adminId,
      code: 'WBCREDIT',
      kind: 'referral',
      rewardType: 'credit',
      rateBps: 2000,
      buyerDiscountBps: 0,
    });
    const buyer = await seedUser(t, { email: 'f@test.fr' });
    const eventId = await seedEvent(t, buyer);
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_credit',
      affiliateId: filleul.id,
    });
    await confirm({ sessionId: 'cs_credit', netMinor: CATALOG, commissionBaseMinor: HT_BASE });
    const [row] = await ledger();
    await t.run(async (ctx) => ctx.db.patch(row!._id, { vestsAt: Date.now() - 1 }));
    await t.mutation(internal.affiliate.vestDueReferrals, {});

    await expect(
      t.mutation(api.affiliate.markReferralPaid, { adminId, referralId: row!._id }),
    ).rejects.toThrow('REFERRAL_NOT_PAYABLE');

    const [after] = await ledger();
    expect(after?.status).toBe('vested');
  });
});

describe('Crédit de parrainage — réservation et dépense', () => {
  /** Parrain avec une ligne de crédit acquise, prête à être dépensée. */
  async function sponsorWithCredit(amount: number) {
    const sponsor = await seedUser(t, { email: 'parrain@test.fr' });
    const aff = await t.mutation(api.affiliate.createAffiliate, {
      adminId,
      code: 'WBPARRAIN',
      kind: 'referral',
      rewardType: 'credit',
      rateBps: 2000,
      buyerDiscountBps: 0,
    });
    await t.mutation(api.affiliate.setAffiliateOwner, {
      adminId,
      affiliateId: aff.id,
      ownerUserId: sponsor,
    });
    const now = Date.now();
    const referralId = await t.run(async (ctx) =>
      ctx.db.insert('affiliateReferrals', {
        affiliateId: aff.id,
        code: 'WBPARRAIN',
        sourceSessionId: 'cs_origine',
        grossMinor: CATALOG,
        netMinor: CATALOG,
        currency: 'EUR',
        rewardMinor: amount,
        rewardType: 'credit' as const,
        status: 'vested' as const,
        vestsAt: now - DAY,
        createdAt: now - DAY,
        updatedAt: now - DAY,
      }),
    );
    return { sponsor, referralId };
  }

  it('réserve puis consomme le crédit à la confirmation du paiement', async () => {
    const { sponsor, referralId } = await sponsorWithCredit(1000);
    const reserved = await t.mutation(api.affiliate.reserveCreditForCheckout, {
      userId: sponsor,
      reservationId: 'resa-1',
      currency: 'EUR',
      orderMinor: CATALOG,
    });
    expect(reserved.appliedMinor).toBe(1000);

    // Réservé = plus sélectionnable par un second checkout (anti double-dépense).
    const second = await t.mutation(api.affiliate.reserveCreditForCheckout, {
      userId: sponsor,
      reservationId: 'resa-2',
      currency: 'EUR',
      orderMinor: CATALOG,
    });
    expect(second.appliedMinor).toBe(0);

    // Idempotence : la même réservation rejouée rend le même montant.
    expect(
      (
        await t.mutation(api.affiliate.reserveCreditForCheckout, {
          userId: sponsor,
          reservationId: 'resa-1',
          currency: 'EUR',
          orderMinor: CATALOG,
        })
      ).appliedMinor,
    ).toBe(1000);

    const eventId = await seedEvent(t, sponsor);
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('payments', {
        userId: sponsor,
        eventId,
        kind: 'plan' as const,
        plan: 'premium' as const,
        currency: 'EUR' as const,
        amountMinor: CATALOG,
        provider: 'stripe' as const,
        providerSessionId: 'cs_spend',
        creditReservationId: 'resa-1',
        status: 'pending' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return id;
    });
    await confirm({ sessionId: 'cs_spend' });

    const line = await t.run(async (ctx) => ctx.db.get(referralId));
    expect(line?.status).toBe('credited');
    expect(line?.consumedBySession).toBe('cs_spend');
    expect(line?.reservedForSession).toBeUndefined();
  });

  it('relâcher une réservation rend le crédit à nouveau dépensable', async () => {
    const { sponsor, referralId } = await sponsorWithCredit(1000);
    await t.mutation(api.affiliate.reserveCreditForCheckout, {
      userId: sponsor,
      reservationId: 'resa-x',
      currency: 'EUR',
      orderMinor: CATALOG,
    });
    await t.mutation(api.affiliate.releaseCreditReservationMutation, { reservationId: 'resa-x' });

    const line = await t.run(async (ctx) => ctx.db.get(referralId));
    expect(line?.status).toBe('vested');
    expect(line?.reservedForSession).toBeUndefined();

    const again = await t.mutation(api.affiliate.reserveCreditForCheckout, {
      userId: sponsor,
      reservationId: 'resa-y',
      currency: 'EUR',
      orderMinor: CATALOG,
    });
    expect(again.appliedMinor).toBe(1000);
  });

  it('ne mélange jamais les devises', async () => {
    const { sponsor } = await sponsorWithCredit(1000);
    const usd = await t.mutation(api.affiliate.reserveCreditForCheckout, {
      userId: sponsor,
      reservationId: 'resa-usd',
      currency: 'USD',
      orderMinor: CATALOG,
    });
    expect(usd.appliedMinor).toBe(0);
  });
});

describe('Remboursement et litige — le webhook reprend la commission', () => {
  async function saleThenRefund(refundedAmountMinor: number) {
    const aff = await partner('SARAH12');
    const buyer = await seedUser(t, { email: 'f@test.fr' });
    const eventId = await seedEvent(t, buyer);
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_wh',
      affiliateId: aff.id,
    });
    await confirm({ sessionId: 'cs_wh', netMinor: CATALOG, commissionBaseMinor: HT_BASE });
    return t.mutation(api.payments.markRefundedByWebhook, {
      webhookSecret: WEBHOOK_SECRET,
      provider: 'stripe',
      providerSessionId: 'cs_wh',
      providerEventId: 'evt_refund',
      refundedAmountMinor,
    });
  }

  it('un remboursement total annule la commission', async () => {
    // Régression : `reverseReferralBySession` n'était appelé QUE depuis le
    // back-office. Un remboursement fait au Dashboard Stripe, ou un litige,
    // laissait la commission s'acquérir puis se faire verser.
    const res = await saleThenRefund(CATALOG);
    expect(res.status).toBe('refunded');
    const [row] = await ledger();
    expect(row?.status).toBe('reversed');
  });

  it('un remboursement partiel annule aussi la commission', async () => {
    const res = await saleThenRefund(1000);
    expect(res.status).toBe('partially_refunded');
    const [row] = await ledger();
    // La vente n'est plus entière : la commission ne peut pas rester due.
    expect(row?.status).toBe('reversed');
  });

  it('rejouer le webhook de remboursement ne casse rien', async () => {
    await saleThenRefund(CATALOG);
    const again = await t.mutation(api.payments.markRefundedByWebhook, {
      webhookSecret: WEBHOOK_SECRET,
      provider: 'stripe',
      providerSessionId: 'cs_wh',
      providerEventId: 'evt_refund_2',
      refundedAmountMinor: CATALOG,
    });
    expect(again.status).toBe('refunded');
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('reversed');
  });

  it('restitue le crédit que l’acheteur avait dépensé sur cet achat', async () => {
    const sponsor = await seedUser(t, { email: 'parrain@test.fr' });
    const aff = await t.mutation(api.affiliate.createAffiliate, {
      adminId,
      code: 'WBPARRAIN',
      kind: 'referral',
      rewardType: 'credit',
      rateBps: 2000,
      buyerDiscountBps: 0,
    });
    await t.mutation(api.affiliate.setAffiliateOwner, {
      adminId,
      affiliateId: aff.id,
      ownerUserId: sponsor,
    });
    const now = Date.now();
    const creditId = await t.run(async (ctx) =>
      ctx.db.insert('affiliateReferrals', {
        affiliateId: aff.id,
        code: 'WBPARRAIN',
        sourceSessionId: 'cs_origine',
        grossMinor: CATALOG,
        netMinor: CATALOG,
        currency: 'EUR',
        rewardMinor: 1000,
        rewardType: 'credit' as const,
        status: 'vested' as const,
        vestsAt: now - DAY,
        createdAt: now - DAY,
        updatedAt: now - DAY,
      }),
    );
    await t.mutation(api.affiliate.reserveCreditForCheckout, {
      userId: sponsor,
      reservationId: 'resa-r',
      currency: 'EUR',
      orderMinor: CATALOG,
    });
    const eventId = await seedEvent(t, sponsor);
    await t.run(async (ctx) =>
      ctx.db.insert('payments', {
        userId: sponsor,
        eventId,
        kind: 'plan' as const,
        plan: 'premium' as const,
        currency: 'EUR' as const,
        amountMinor: CATALOG,
        provider: 'stripe' as const,
        providerSessionId: 'cs_credit_refund',
        creditReservationId: 'resa-r',
        status: 'pending' as const,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await confirm({ sessionId: 'cs_credit_refund' });
    expect((await t.run(async (ctx) => ctx.db.get(creditId)))?.status).toBe('credited');

    await t.mutation(api.payments.markRefundedByWebhook, {
      webhookSecret: WEBHOOK_SECRET,
      provider: 'stripe',
      providerSessionId: 'cs_credit_refund',
      providerEventId: 'evt_credit_refund',
      refundedAmountMinor: CATALOG,
    });
    const restored = await t.run(async (ctx) => ctx.db.get(creditId));
    expect(restored?.status).toBe('vested');
    expect(restored?.consumedBySession).toBeUndefined();
  });

  it('un litige suspend la commission SANS marquer le paiement remboursé', async () => {
    // L'argent est retenu, pas rendu, et le marchand peut gagner. Marquer
    // `refunded` serait sans retour : l'admin ne pourrait plus rembourser
    // (`NOT_REFUNDABLE`) et les analytics excluraient la vente à vie.
    const aff = await partner('SARAH12');
    const buyer = await seedUser(t, { email: 'f@test.fr' });
    const eventId = await seedEvent(t, buyer);
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_litige',
      affiliateId: aff.id,
    });
    await confirm({ sessionId: 'cs_litige', netMinor: CATALOG, commissionBaseMinor: HT_BASE });

    await t.mutation(api.payments.markRefundedByWebhook, {
      webhookSecret: WEBHOOK_SECRET,
      provider: 'stripe',
      providerSessionId: 'cs_litige',
      providerEventId: 'evt_dispute',
      refundedAmountMinor: CATALOG,
      chargedAmountMinor: CATALOG,
      disputed: true,
    });

    expect((await ledger())[0]?.status).toBe('reversed');
    const payment = await t.run(async (ctx) =>
      ctx.db
        .query('payments')
        .withIndex('by_session', (q) =>
          q.eq('provider', 'stripe').eq('providerSessionId', 'cs_litige'),
        )
        .first(),
    );
    expect(payment?.status).toBe('succeeded');
    expect(payment?.refundedAmountMinor).toBeUndefined();
  });

  it('un remboursement TOTAL d’un achat remisé n’est pas classé partiel', async () => {
    // Le montant stocké est le prix CATALOGUE (59 €), le débit réel 53,10 €.
    // Comparer le remboursement au catalogue faisait passer un remboursement
    // intégral pour partiel, et l'écran admin proposait un reliquat fantôme
    // que Stripe refuse.
    const aff = await partner('SARAH12');
    const buyer = await seedUser(t, { email: 'f@test.fr' });
    const eventId = await seedEvent(t, buyer);
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_remise',
      affiliateId: aff.id,
    });
    await confirm({
      sessionId: 'cs_remise',
      netMinor: NET_AFTER_DISCOUNT,
      commissionBaseMinor: HT_BASE,
    });

    const res = await t.mutation(api.payments.markRefundedByWebhook, {
      webhookSecret: WEBHOOK_SECRET,
      provider: 'stripe',
      providerSessionId: 'cs_remise',
      providerEventId: 'evt_full',
      refundedAmountMinor: NET_AFTER_DISCOUNT,
      chargedAmountMinor: NET_AFTER_DISCOUNT,
    });
    expect(res.status).toBe('refunded');

    const payment = await t.run(async (ctx) =>
      ctx.db
        .query('payments')
        .withIndex('by_session', (q) =>
          q.eq('provider', 'stripe').eq('providerSessionId', 'cs_remise'),
        )
        .first(),
    );
    // Plus aucun reliquat à proposer au back-office.
    expect(payment?.amountMinor).toBe(payment?.refundedAmountMinor);
  });

  it('webhook et back-office n’additionnent pas le même remboursement', async () => {
    // Les deux écrivent `refundedAmountMinor` et se croisent à chaque
    // remboursement déclenché de l'admin : le webhook porte le CUMUL Stripe,
    // l'admin un incrément. Le total partait au double, voire en
    // `REFUND_EXCEEDS_AMOUNT` alors que l'argent était déjà parti.
    const aff = await partner('SARAH12');
    const buyer = await seedUser(t, { email: 'f@test.fr' });
    const eventId = await seedEvent(t, buyer);
    await seedPendingPayment(t, {
      userId: buyer,
      eventId,
      amountMinor: CATALOG,
      sessionId: 'cs_course',
      affiliateId: aff.id,
    });
    await confirm({ sessionId: 'cs_course', netMinor: CATALOG, commissionBaseMinor: HT_BASE });
    const payment = await t.run(async (ctx) =>
      ctx.db
        .query('payments')
        .withIndex('by_session', (q) =>
          q.eq('provider', 'stripe').eq('providerSessionId', 'cs_course'),
        )
        .first(),
    );

    // Le webhook gagne la course et écrit le cumul…
    await t.mutation(api.payments.markRefundedByWebhook, {
      webhookSecret: WEBHOOK_SECRET,
      provider: 'stripe',
      providerSessionId: 'cs_course',
      providerEventId: 'evt_course',
      refundedAmountMinor: CATALOG,
      chargedAmountMinor: CATALOG,
    });
    // …puis la mutation admin arrive avec SON cumul, calculé avant Stripe.
    const marked = await t.mutation(api.admin.markPaymentRefunded, {
      adminId,
      paymentId: payment!._id,
      refundAmountMinor: CATALOG,
      totalRefundedMinor: CATALOG,
    });
    expect(marked).toEqual({ ok: true, status: 'refunded' });

    const after = await t.run(async (ctx) => ctx.db.get(payment!._id));
    expect(after?.refundedAmountMinor).toBe(CATALOG);
  });

  it('refuse un appel sans le secret partagé', async () => {
    await expect(
      t.mutation(api.payments.markRefundedByWebhook, {
        webhookSecret: 'pas-le-bon',
        provider: 'stripe',
        providerSessionId: 'cs_wh',
        providerEventId: 'evt',
        refundedAmountMinor: 100,
      }),
    ).rejects.toThrow('INVALID_WEBHOOK_SECRET');
  });
});
