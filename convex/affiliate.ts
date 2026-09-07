/**
 * Programme d'affiliation / parrainage — backend Convex (le « moteur »).
 *
 * S'appuie sur la logique pure de `lib/affiliate.ts` (déjà testée). Le ledger
 * (`affiliateReferrals`) est la source de vérité : écriture IDEMPOTENTE sur
 * `sourceSessionId` (webhooks Stripe at-least-once), vesting à la date event,
 * reversal sur remboursement/litige. Le VERSEMENT (crédit auto / cash) se
 * branche par-dessus (phase suivante) — ici on ne calcule et ne suit que le dû.
 */
import { v } from 'convex/values';
import {
  mutation,
  query,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import {
  DEFAULT_RATE_BPS,
  isRewardConfigSafe,
  isSelfReferral,
  isValidAffiliateCode,
  normalizeAffiliateCode,
  rewardMinor,
  settledStatusFor,
  vestsAt as computeVestsAt,
  isVestable,
  canReverse,
  generateReferralCode,
  selectReferralsToConsume,
  type ReferralStatus,
} from './lib/affiliate';

/** Garde admin (miroir de `admin.ts`, volontairement convex-local). */
async function assertAdmin(
  ctx: { db: { get: (id: Id<'users'>) => Promise<{ role: string } | null> } },
  adminId: Id<'users'>,
) {
  const user = await ctx.db.get(adminId);
  if (!user || user.role !== 'admin') throw new Error('FORBIDDEN: admin role required');
  return user;
}

/* ============================ Création (admin) ============================ */

/**
 * Crée un affilié + son code. `partner` = cash (invitation-only, payout
 * différé), `referral` = crédit (boucle particulier). Le garde-fou marge
 * (`isRewardConfigSafe`) refuse tout cumul remise+commission dangereux.
 */
export const createAffiliate = mutation({
  args: {
    adminId: v.id('users'),
    code: v.string(),
    kind: v.union(v.literal('referral'), v.literal('partner')),
    rewardType: v.union(v.literal('credit'), v.literal('cash')),
    rateBps: v.number(),
    buyerDiscountBps: v.number(),
    ownerUserId: v.optional(v.id('users')),
    ownerEmail: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.adminId);

    const code = normalizeAffiliateCode(args.code);
    if (!isValidAffiliateCode(code)) throw new Error('INVALID_CODE');
    if (!isRewardConfigSafe({ rateBps: args.rateBps, buyerDiscountBps: args.buyerDiscountBps })) {
      throw new Error('UNSAFE_REWARD_CONFIG');
    }

    const existing = await ctx.db
      .query('affiliates')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first();
    if (existing) throw new Error('CODE_ALREADY_EXISTS');

    const now = Date.now();
    const id = await ctx.db.insert('affiliates', {
      code,
      kind: args.kind,
      rewardType: args.rewardType,
      rateBps: args.rateBps,
      buyerDiscountBps: args.buyerDiscountBps,
      ownerUserId: args.ownerUserId,
      ownerEmail: args.ownerEmail?.trim().toLowerCase(),
      displayName: args.displayName?.trim(),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    return { id, code };
  },
});

/** Active/désactive un affilié (admin). */
export const setAffiliateStatus = mutation({
  args: {
    adminId: v.id('users'),
    affiliateId: v.id('affiliates'),
    status: v.union(v.literal('active'), v.literal('disabled')),
  },
  handler: async (ctx, { adminId, affiliateId, status }) => {
    await assertAdmin(ctx, adminId);
    await ctx.db.patch(affiliateId, { status, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Rattache le coupon + code promo Stripe créés pour un affilié.
 *
 * L'appel Stripe vit côté app (Convex ne peut pas sortir sur le réseau depuis
 * une mutation), donc la séquence est : créer l'affilié ici (source de vérité,
 * qui garantit l'unicité du code), créer le coupon côté Stripe, puis rattacher
 * les ids avec cette mutation. Si Stripe échoue, l'affilié reste utilisable —
 * son lien `?ref=` attribue toujours — et l'admin peut relancer la création.
 */
export const setAffiliateStripeCoupon = mutation({
  args: {
    adminId: v.id('users'),
    affiliateId: v.id('affiliates'),
    stripeCouponId: v.string(),
    stripePromotionCodeId: v.string(),
  },
  handler: async (ctx, { adminId, affiliateId, stripeCouponId, stripePromotionCodeId }) => {
    await assertAdmin(ctx, adminId);
    const aff = await ctx.db.get(affiliateId);
    if (!aff) throw new Error('AFFILIATE_NOT_FOUND');
    await ctx.db.patch(affiliateId, {
      stripeCouponId,
      stripePromotionCodeId,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Lecture admin d'un affilié — sert à la création différée du coupon Stripe
 * (on a besoin du code et du taux de remise côté server action).
 */
export const getAffiliateForAdmin = query({
  args: { adminId: v.id('users'), affiliateId: v.id('affiliates') },
  handler: async (ctx, { adminId, affiliateId }) => {
    await assertAdmin(ctx, adminId);
    const aff = await ctx.db.get(affiliateId);
    if (!aff) return null;
    return {
      id: aff._id,
      code: aff.code,
      kind: aff.kind,
      buyerDiscountBps: aff.buyerDiscountBps,
      displayName: aff.displayName ?? null,
      status: aff.status,
      stripeCouponId: aff.stripeCouponId ?? null,
      stripePromotionCodeId: aff.stripePromotionCodeId ?? null,
    };
  },
});

/* ============================ Attribution ============================ */

/**
 * Résout un code saisi (`?ref=CODE` ou code promo tapé au checkout) vers
 * l'affilié ACTIF correspondant. Helper partagé — réutilisé par la query
 * publique du checkout ET par `markSucceeded` (rattrapage d'attribution quand
 * l'acheteur a tapé le code au lieu de cliquer le lien).
 */
export async function findActiveAffiliateByCode(
  ctx: QueryCtx,
  code: string,
): Promise<Doc<'affiliates'> | null> {
  const normalized = normalizeAffiliateCode(code);
  if (!isValidAffiliateCode(normalized)) return null;
  const aff = await ctx.db
    .query('affiliates')
    .withIndex('by_code', (q) => q.eq('code', normalized))
    .first();
  if (!aff || aff.status !== 'active') return null;
  return aff;
}

/**
 * Résout un code (`?ref=CODE`) vers l'affilié actif — utilisé au checkout pour
 * poser `metadata.affiliateId` sur la Session ET pour appliquer la remise
 * filleul (`buyerDiscountBps`). Ne révèle que le strict nécessaire (jamais
 * d'infos internes).
 */
export const getAffiliateByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const aff = await findActiveAffiliateByCode(ctx, code);
    if (!aff) return null;
    return {
      id: aff._id,
      code: aff.code,
      kind: aff.kind,
      rewardType: aff.rewardType,
      buyerDiscountBps: aff.buyerDiscountBps,
    };
  },
});

/**
 * Cœur d'écriture du ledger — helper Convex réutilisable DANS une transaction
 * existante (pas un endpoint) : appelé par `payments.markSucceeded` à la
 * confirmation d'un paiement attribué, en best-effort. Idempotent sur
 * `sourceSessionId` (webhook Stripe rejoué safe), anti-self-referral, récompense
 * calculée sur le net, vesting à la date event.
 */
export async function applyReferral(
  ctx: MutationCtx,
  args: {
    affiliateId: Id<'affiliates'>;
    sourceSessionId: string;
    grossMinor: number;
    netMinor: number;
    currency: string;
    purchasedAt: number;
    eventDate?: number;
    eventId?: Id<'events'>;
    buyerUserId?: Id<'users'>;
    buyerEmail?: string | null;
  },
): Promise<
  | { outcome: 'deduped'; referralId: Id<'affiliateReferrals'> }
  | { outcome: 'inactive' }
  | { outcome: 'self_referral' }
  | { outcome: 'recorded'; referralId: Id<'affiliateReferrals'> }
> {
  const dup = await ctx.db
    .query('affiliateReferrals')
    .withIndex('by_source_session', (q) => q.eq('sourceSessionId', args.sourceSessionId))
    .first();
  if (dup) return { outcome: 'deduped', referralId: dup._id };

  const aff = await ctx.db.get(args.affiliateId);
  if (!aff || aff.status !== 'active') return { outcome: 'inactive' };

  if (
    isSelfReferral({
      affiliateOwnerUserId: aff.ownerUserId ?? null,
      buyerUserId: args.buyerUserId ?? null,
      affiliateEmail: aff.ownerEmail ?? null,
      buyerEmail: args.buyerEmail ?? null,
    })
  ) {
    return { outcome: 'self_referral' };
  }

  const now = Date.now();
  const referralId = await ctx.db.insert('affiliateReferrals', {
    affiliateId: aff._id,
    code: aff.code,
    sourceSessionId: args.sourceSessionId,
    paymentId: undefined,
    eventId: args.eventId,
    buyerUserId: args.buyerUserId,
    grossMinor: args.grossMinor,
    netMinor: args.netMinor,
    currency: args.currency,
    rewardMinor: rewardMinor(args.netMinor, aff.rateBps),
    rewardType: aff.rewardType,
    status: 'pending',
    vestsAt: computeVestsAt(args.eventDate ?? Number.NaN, args.purchasedAt),
    createdAt: now,
    updatedAt: now,
  });
  return { outcome: 'recorded', referralId };
}

/** Wrapper interne (ops / rejeu manuel). Le flux nominal passe par markSucceeded. */
export const recordReferral = internalMutation({
  args: {
    affiliateId: v.id('affiliates'),
    sourceSessionId: v.string(),
    grossMinor: v.number(),
    netMinor: v.number(),
    currency: v.string(),
    purchasedAt: v.number(),
    eventDate: v.optional(v.number()),
    eventId: v.optional(v.id('events')),
    buyerUserId: v.optional(v.id('users')),
    buyerEmail: v.optional(v.string()),
  },
  handler: (ctx, args) => applyReferral(ctx, args),
});

/**
 * Annule une récompense (remboursement / litige) tant qu'elle n'est pas versée.
 * Helper réutilisable dans une transaction (appelé par la mutation de refund).
 * Idempotent et sans effet si déjà terminale (paid/credited/reversed).
 */
export async function reverseReferralBySession(
  ctx: MutationCtx,
  sourceSessionId: string,
): Promise<{ outcome: 'noop' } | { outcome: 'reversed'; referralId: Id<'affiliateReferrals'> }> {
  const ref = await ctx.db
    .query('affiliateReferrals')
    .withIndex('by_source_session', (q) => q.eq('sourceSessionId', sourceSessionId))
    .first();
  if (!ref || !canReverse(ref.status)) return { outcome: 'noop' };
  await ctx.db.patch(ref._id, {
    status: 'reversed',
    reversedAt: Date.now(),
    updatedAt: Date.now(),
  });
  return { outcome: 'reversed', referralId: ref._id };
}

export const reverseReferral = internalMutation({
  args: { sourceSessionId: v.string() },
  handler: (ctx, { sourceSessionId }) => reverseReferralBySession(ctx, sourceSessionId),
});

/* ============================ Vesting (cron) ============================ */

/**
 * Passe `pending` → `vested` toute récompense dont `vestsAt` est atteint (fin
 * du risque de remboursement « event non envoyé »). Lot borné par appel.
 */
export const vestDueReferrals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query('affiliateReferrals')
      .withIndex('by_status_vests', (q) => q.eq('status', 'pending').lte('vestsAt', now))
      .take(200);
    let vested = 0;
    for (const ref of due) {
      if (!isVestable({ status: ref.status, vestsAt: ref.vestsAt }, now)) continue;
      await ctx.db.patch(ref._id, { status: 'vested', updatedAt: now });
      vested += 1;
    }
    return { vested };
  },
});

/* ============================ Lecture admin ============================ */

export const listAffiliates = query({
  args: { adminId: v.id('users') },
  handler: async (ctx, { adminId }) => {
    await assertAdmin(ctx, adminId);
    const rows = await ctx.db.query('affiliates').order('desc').collect();
    return rows.map((a) => ({
      id: a._id,
      code: a.code,
      kind: a.kind,
      rewardType: a.rewardType,
      rateBps: a.rateBps,
      buyerDiscountBps: a.buyerDiscountBps,
      ownerEmail: a.ownerEmail ?? null,
      displayName: a.displayName ?? null,
      status: a.status,
      /** Code promo Stripe rattaché → le code est saisissable au checkout. */
      shareCode: a.stripePromotionCodeId ? a.code : null,
      stripePromotionCodeId: a.stripePromotionCodeId ?? null,
      createdAt: a.createdAt,
    }));
  },
});

/**
 * Ledger pour l'admin : lignes + agrégats par statut (montants par devise).
 * Sert le dashboard « commissions dues » (payout groupé manuel au MVP).
 */
export const listReferrals = query({
  args: {
    adminId: v.id('users'),
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('vested'),
        v.literal('paid'),
        v.literal('credited'),
        v.literal('reversed'),
      ),
    ),
  },
  handler: async (ctx, { adminId, status }) => {
    await assertAdmin(ctx, adminId);
    const rows = status
      ? await ctx.db
          .query('affiliateReferrals')
          .withIndex('by_status', (q) => q.eq('status', status))
          .order('desc')
          .take(500)
      : await ctx.db.query('affiliateReferrals').order('desc').take(500);
    return rows.map((r) => ({
      id: r._id,
      affiliateId: r.affiliateId,
      code: r.code,
      status: r.status,
      rewardType: r.rewardType,
      rewardMinor: r.rewardMinor,
      netMinor: r.netMinor,
      currency: r.currency,
      vestsAt: r.vestsAt,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * Crédit disponible d'un parrain (referral, type crédit) : somme des
 * récompenses `vested` non encore consommées. Base de l'application du crédit
 * (coupon Stripe généré à la volée) au prochain checkout — phase suivante.
 */
export const referrerCreditMinor = query({
  args: { userId: v.id('users'), currency: v.string() },
  handler: async (ctx, { userId, currency }) => {
    const affiliates = await ctx.db
      .query('affiliates')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', userId))
      .collect();
    const creditIds = new Set(
      affiliates.filter((a) => a.rewardType === 'credit').map((a) => a._id),
    );
    if (creditIds.size === 0) return { availableMinor: 0 };
    let availableMinor = 0;
    for (const affId of creditIds) {
      const vested = await ctx.db
        .query('affiliateReferrals')
        .withIndex('by_affiliate', (q) => q.eq('affiliateId', affId))
        .collect();
      for (const r of vested) {
        if (r.status === 'vested' && r.currency === currency) availableMinor += r.rewardMinor;
      }
    }
    return { availableMinor };
  },
});

/**
 * Marque une récompense comme versée (crédit consommé / cash payé). Idempotent :
 * sans effet si déjà terminale. `settledStatusFor` choisit credited|paid.
 */
export const markReferralSettled = internalMutation({
  args: { referralId: v.id('affiliateReferrals') },
  handler: async (ctx, { referralId }) => {
    const ref = await ctx.db.get(referralId);
    if (!ref || ref.status !== 'vested') return { outcome: 'noop' as const };
    await ctx.db.patch(referralId, {
      status: settledStatusFor(ref.rewardType),
      paidAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { outcome: 'settled' as const };
  },
});

/* ======================= Parrainage — code + crédit ======================= */

/**
 * Récompenses `vested` de type crédit d'un user, devise-matchées, NON réservées,
 * triées FIFO. « Disponible » = dépensable maintenant (exclut le crédit déjà
 * réservé par un checkout en cours → cohérent avec l'anti double-dépense).
 * Lecture bornée via l'index `by_affiliate_status`.
 */
export async function collectVestedCredit(
  ctx: QueryCtx,
  userId: Id<'users'>,
  currency: string,
): Promise<Array<{ id: Id<'affiliateReferrals'>; rewardMinor: number; createdAt: number }>> {
  const affiliates = await ctx.db
    .query('affiliates')
    .withIndex('by_owner', (q) => q.eq('ownerUserId', userId))
    .collect();
  const rows: Array<{ id: Id<'affiliateReferrals'>; rewardMinor: number; createdAt: number }> = [];
  for (const aff of affiliates) {
    if (aff.rewardType !== 'credit') continue;
    const refs = await ctx.db
      .query('affiliateReferrals')
      .withIndex('by_affiliate_status', (q) => q.eq('affiliateId', aff._id).eq('status', 'vested'))
      .collect();
    for (const r of refs) {
      if (r.currency === currency && !r.reservedForSession) {
        rows.push({ id: r._id, rewardMinor: r.rewardMinor, createdAt: r.createdAt });
      }
    }
  }
  rows.sort((a, b) => a.createdAt - b.createdAt); // FIFO
  return rows;
}

/**
 * Garantit qu'un user a son code de parrainage (kind referral / crédit, taux
 * défaut, 0 % de remise filleul). Idempotent — retourne l'existant, sinon crée
 * avec un code déterministe unique (collision → tentative suivante). Helper
 * appelé à la confirmation d'un achat ET par l'espace couple.
 */
export async function ensureReferralAffiliate(
  ctx: MutationCtx,
  userId: Id<'users'>,
): Promise<{ affiliateId: Id<'affiliates'>; code: string }> {
  const existing = await ctx.db
    .query('affiliates')
    .withIndex('by_owner', (q) => q.eq('ownerUserId', userId))
    .collect();
  const referral = existing.find((a) => a.kind === 'referral');
  if (referral) return { affiliateId: referral._id, code: referral.code };

  let code = generateReferralCode(userId, 0);
  for (let attempt = 1; attempt < 12; attempt++) {
    const clash = await ctx.db
      .query('affiliates')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first();
    if (!clash) break;
    code = generateReferralCode(userId, attempt);
  }
  const now = Date.now();
  const affiliateId = await ctx.db.insert('affiliates', {
    code,
    kind: 'referral',
    rewardType: 'credit',
    rateBps: DEFAULT_RATE_BPS,
    buyerDiscountBps: 0,
    ownerUserId: userId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  return { affiliateId, code };
}

/** Mutation publique : l'espace couple garantit/récupère son code de parrainage. */
export const ensureReferralCode = mutation({
  args: { userId: v.id('users') },
  handler: (ctx, { userId }) => ensureReferralAffiliate(ctx, userId),
});

/** Code de parrainage + crédit disponible d'un user (espace couple). */
export const referralForUser = query({
  args: { userId: v.id('users'), currency: v.string() },
  handler: async (ctx, { userId, currency }) => {
    const affiliates = await ctx.db
      .query('affiliates')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', userId))
      .collect();
    const referral = affiliates.find((a) => a.kind === 'referral');
    const vested = await collectVestedCredit(ctx, userId, currency);
    const availableMinor = vested.reduce((s, r) => s + r.rewardMinor, 0);
    return { code: referral?.code ?? null, availableMinor };
  },
});

/**
 * RÉSERVE atomiquement le crédit d'un user pour un checkout, AVANT la création du
 * coupon Stripe (le montant réservé = le montant du coupon → jamais de sur-remise
 * ni de crédit gratuit). Sélectionne les lignes `vested` NON réservées (FIFO,
 * entières, cumul ≤ orderMinor) et les marque `reservedForSession = reservationId`
 * dans UNE seule mutation → l'OCC de Convex empêche la double-réservation
 * concurrente (deux checkouts ne peuvent pas réserver la même ligne). Idempotent
 * par `reservationId`. Retourne le montant réellement réservé.
 */
export const reserveCreditForCheckout = mutation({
  args: {
    userId: v.id('users'),
    reservationId: v.string(),
    currency: v.string(),
    orderMinor: v.number(),
  },
  handler: async (ctx, { userId, reservationId, currency, orderMinor }) => {
    const empty = { appliedMinor: 0, referralIds: [] as Id<'affiliateReferrals'>[] };
    const dup = await ctx.db
      .query('pendingCreditApplications')
      .withIndex('by_reservation', (q) => q.eq('reservationId', reservationId))
      .first();
    if (dup) return { appliedMinor: dup.appliedMinor, referralIds: dup.referralIds };

    // collectVestedCredit exclut déjà les lignes réservées ailleurs.
    const vested = await collectVestedCredit(ctx, userId, currency);
    const { referralIds } = selectReferralsToConsume(
      vested.map((r) => ({ id: r.id, rewardMinor: r.rewardMinor })),
      orderMinor,
    );
    if (referralIds.length === 0) return empty;

    const now = Date.now();
    const reserved: Id<'affiliateReferrals'>[] = [];
    let appliedMinor = 0;
    for (const id of referralIds) {
      const r = await ctx.db.get(id as Id<'affiliateReferrals'>);
      // Re-vérif dans la mutation (fenêtre OCC) : encore vested, crédit, bonne
      // devise, NON réservée.
      if (
        r &&
        r.status === 'vested' &&
        r.rewardType === 'credit' &&
        r.currency === currency &&
        !r.reservedForSession
      ) {
        await ctx.db.patch(r._id, { reservedForSession: reservationId, updatedAt: now });
        reserved.push(r._id);
        appliedMinor += r.rewardMinor;
      }
    }
    if (reserved.length === 0) return empty;
    await ctx.db.insert('pendingCreditApplications', {
      reservationId,
      userId,
      currency,
      appliedMinor,
      referralIds: reserved,
      createdAt: now,
    });
    return { appliedMinor, referralIds: reserved };
  },
});

/**
 * Consomme une réservation à la confirmation du paiement (plan/upsell) : lignes
 * réservées → `credited`, trace `consumedBySession` (= session d'achat, pour
 * restitution au refund), efface la réservation. Idempotent (réservation absente
 * → noop ; ligne déjà non-`vested` → ignorée). Helper intra-Convex.
 */
export async function consumeCreditReservation(
  ctx: MutationCtx,
  reservationId: string | undefined | null,
  purchaseSessionId: string,
): Promise<{ consumedMinor: number; count: number }> {
  if (!reservationId) return { consumedMinor: 0, count: 0 };
  const pending = await ctx.db
    .query('pendingCreditApplications')
    .withIndex('by_reservation', (q) => q.eq('reservationId', reservationId))
    .first();
  if (!pending) return { consumedMinor: 0, count: 0 };
  const now = Date.now();
  let consumedMinor = 0;
  let count = 0;
  for (const id of pending.referralIds) {
    const r = await ctx.db.get(id);
    if (r && r.status === 'vested') {
      await ctx.db.patch(id, {
        status: 'credited',
        reservedForSession: undefined,
        consumedBySession: purchaseSessionId,
        paidAt: now,
        updatedAt: now,
      });
      consumedMinor += r.rewardMinor;
      count += 1;
    }
  }
  await ctx.db.delete(pending._id);
  return { consumedMinor, count };
}

/**
 * Relâche une réservation NON consommée (checkout échoué/abandonné) : ré-ouvre
 * les lignes (`reservedForSession` effacé, restent `vested`) et supprime la
 * réservation. Idempotent — le crédit redevient dépensable.
 */
export async function releaseCreditReservation(
  ctx: MutationCtx,
  reservationId: string | undefined | null,
): Promise<{ released: number }> {
  if (!reservationId) return { released: 0 };
  const pending = await ctx.db
    .query('pendingCreditApplications')
    .withIndex('by_reservation', (q) => q.eq('reservationId', reservationId))
    .first();
  if (!pending) return { released: 0 };
  const now = Date.now();
  let released = 0;
  for (const id of pending.referralIds) {
    const r = await ctx.db.get(id);
    if (r && r.reservedForSession === reservationId) {
      await ctx.db.patch(id, { reservedForSession: undefined, updatedAt: now });
      released += 1;
    }
  }
  await ctx.db.delete(pending._id);
  return { released };
}

/** Mutation publique : la route relâche la réservation si le checkout échoue. */
export const releaseCreditReservationMutation = mutation({
  args: { reservationId: v.string() },
  handler: (ctx, { reservationId }) => releaseCreditReservation(ctx, reservationId),
});

/**
 * RESTITUE le crédit dépensé sur un achat REMBOURSÉ : les lignes `credited` dont
 * `consumedBySession` == la session remboursée repassent `vested` (crédit
 * ré-ouvert pour le parrain). Appelé par `markPaymentRefunded`. Idempotent.
 */
export async function restoreCreditForRefundedSession(
  ctx: MutationCtx,
  purchaseSessionId: string,
): Promise<{ restored: number; restoredMinor: number }> {
  const rows = await ctx.db
    .query('affiliateReferrals')
    .withIndex('by_consumed_session', (q) => q.eq('consumedBySession', purchaseSessionId))
    .collect();
  const now = Date.now();
  let restored = 0;
  let restoredMinor = 0;
  for (const r of rows) {
    if (r.status === 'credited') {
      await ctx.db.patch(r._id, {
        status: 'vested',
        consumedBySession: undefined,
        paidAt: undefined,
        updatedAt: now,
      });
      restored += 1;
      restoredMinor += r.rewardMinor;
    }
  }
  return { restored, restoredMinor };
}

/**
 * GC (cron) : relâche les réservations orphelines (checkout jamais confirmé),
 * plus vieilles que le `redeem_by` du coupon (24 h) → le crédit redevient
 * disponible. Lot borné.
 */
export const releaseStaleCreditReservations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = await ctx.db.query('pendingCreditApplications').take(200);
    let released = 0;
    for (const p of rows) {
      if (p.createdAt < cutoff) {
        await releaseCreditReservation(ctx, p.reservationId);
        released += 1;
      }
    }
    return { released };
  },
});

/* ======================= Payout partenaire (cash) ======================= */

/**
 * Marque une commission `vested` comme VERSÉE (admin, après virement).
 * Pendant du `markReferralSettled` interne, mais appelable depuis le
 * back-office : sans ça, le ledger n'avait aucun moyen de sortir de `vested`
 * pour un partenaire cash — les commissions s'empilaient en « dû » à vie.
 *
 * Idempotent (sans effet si déjà terminale) et tracé dans `adminAuditLog` :
 * un versement d'argent réel doit laisser une trace nominative.
 */
export const markReferralPaid = mutation({
  args: {
    adminId: v.id('users'),
    referralId: v.id('affiliateReferrals'),
    /** Référence du virement (IBAN partiel, id de virement, n° de facture…). */
    payoutReference: v.optional(v.string()),
  },
  handler: async (ctx, { adminId, referralId, payoutReference }) => {
    await assertAdmin(ctx, adminId);
    const ref = await ctx.db.get(referralId);
    if (!ref) throw new Error('REFERRAL_NOT_FOUND');
    if (ref.status !== 'vested') return { outcome: 'noop' as const, status: ref.status };

    const now = Date.now();
    await ctx.db.patch(referralId, {
      status: settledStatusFor(ref.rewardType),
      paidAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('adminAuditLog', {
      adminId,
      action: 'mark_referral_paid',
      targetType: 'affiliate',
      targetId: referralId,
      details: JSON.stringify({
        code: ref.code,
        rewardMinor: ref.rewardMinor,
        currency: ref.currency,
        rewardType: ref.rewardType,
        ...(payoutReference ? { payoutReference } : {}),
      }),
      createdAt: now,
    });
    return { outcome: 'settled' as const, status: settledStatusFor(ref.rewardType) };
  },
});

/* ======================= Espace partenaire (lecture) ======================= */

/**
 * Tableau de bord d'un partenaire : SES codes et SES commissions, rien d'autre.
 *
 * Volontairement scopé à `by_owner` — un partenaire ne voit jamais le ledger
 * global (c'est `listReferrals`, réservé admin). Aucune donnée acheteur n'est
 * exposée (ni nom, ni email, ni event) : le partenaire a besoin du montant et
 * du statut, pas de l'identité de ses filleuls.
 */
export const partnerDashboard = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const affiliates = await ctx.db
      .query('affiliates')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', userId))
      .collect();
    const partners = affiliates.filter((a) => a.kind === 'partner');
    if (partners.length === 0) return { isPartner: false as const };

    type Row = {
      id: Id<'affiliateReferrals'>;
      code: string;
      status: ReferralStatus;
      rewardMinor: number;
      netMinor: number;
      currency: string;
      vestsAt: number;
      createdAt: number;
    };
    const rows: Row[] = [];
    for (const aff of partners) {
      const refs = await ctx.db
        .query('affiliateReferrals')
        .withIndex('by_affiliate', (q) => q.eq('affiliateId', aff._id))
        .order('desc')
        .take(500);
      for (const r of refs) {
        rows.push({
          id: r._id,
          code: r.code,
          status: r.status,
          rewardMinor: r.rewardMinor,
          netMinor: r.netMinor,
          currency: r.currency,
          vestsAt: r.vestsAt,
          createdAt: r.createdAt,
        });
      }
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);

    // Agrégats par devise × statut — le ledger ne convertit jamais, donc on
    // additionne par devise native (un partenaire multi-marché verra 2 lignes).
    const totals = new Map<string, { currency: string; status: ReferralStatus; minor: number }>();
    for (const r of rows) {
      if (r.status === 'reversed') continue;
      const key = `${r.currency}:${r.status}`;
      const prev = totals.get(key);
      if (prev) prev.minor += r.rewardMinor;
      else totals.set(key, { currency: r.currency, status: r.status, minor: r.rewardMinor });
    }

    return {
      isPartner: true as const,
      codes: partners.map((a) => ({
        code: a.code,
        rateBps: a.rateBps,
        buyerDiscountBps: a.buyerDiscountBps,
        status: a.status,
        displayName: a.displayName ?? null,
        /**
         * Le code est-il RÉELLEMENT saisissable au checkout ? Vrai seulement
         * si un code promo Stripe existe. Sans lui, afficher « partage ton
         * code » serait un mensonge : l'audience taperait un code refusé.
         */
        shareable: Boolean(a.stripePromotionCodeId),
      })),
      referrals: rows.slice(0, 100),
      totals: [...totals.values()],
      salesCount: rows.filter((r) => r.status !== 'reversed').length,
    };
  },
});
