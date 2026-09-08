'use server';

import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { getSession } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import {
  refundPlatformPayment,
  cancelPlatformSubscription,
  reactivatePlatformSubscription,
  listSubscriptionInvoices,
  createCoupon,
  resolveProPlanProductIds,
  listCoupons,
  deleteCoupon,
  createPromotionCode,
  listPromotionCodes,
  setPromotionCodeActive,
  applyCouponToSubscription,
  removeSubscriptionDiscount,
  resolveConsumerPlanProductIds,
  findPromotionCodeByCode,
  retrieveCoupon,
  type SubscriptionInvoice,
  type AdminCoupon,
  type AdminPromotionCode,
} from '@/lib/payments/drivers/stripe';
import type { Currency } from '@/lib/payments/plans';
import { partnerCouponPlan } from '@/lib/payments/affiliate-coupon';

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Vérifie une session ET le rôle `admin` (la session seule ne suffit pas pour
 * les actions financières qui touchent Stripe LIVE avant tout appel Convex).
 * Renvoie l'id de l'admin pour le passer aux fonctions Convex (qui revérifient).
 */
async function requireAdmin(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error('UNAUTHENTICATED');
  const convex = getConvexServerClient();
  const user = await convex.query(convexApi.currentUser, { userId: session.userId });
  if (!user || user.role !== 'admin') throw new Error('FORBIDDEN');
  return session.userId;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : 'UNKNOWN';
}

/**
 * Codes métier des suppressions, extraits du message emballé par Convex.
 *
 * `throw new Error('CONFIRM_MISMATCH')` arrive côté app sous la forme
 * `[Request ID: …] Server Error … Uncaught Error: CONFIRM_MISMATCH at …` : une
 * comparaison stricte ne matcherait jamais, et l'écran afficherait « erreur
 * inconnue » à la place de la seule chose utile (ce qu'il faut corriger).
 */
const DELETION_ERROR_CODES = [
  'CANNOT_DELETE_ADMIN',
  'CONFIRM_MISMATCH',
  'ORG_SUBSCRIPTION_ACTIVE',
  'ORG_HAS_MEMBERS',
  'USER_NOT_FOUND',
  'AFFILIATE_HAS_REFERRALS',
  'AFFILIATE_NOT_FOUND',
  'FORBIDDEN',
] as const;

function deletionErrorCode(e: unknown): string {
  const message = e instanceof Error ? e.message : '';
  return DELETION_ERROR_CODES.find((code) => message.includes(code)) ?? msg(e);
}

export async function adminUnsuspendUserAction(targetUserId: string): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.adminUnsuspendUser, { adminId, targetUserId });
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'UNKNOWN' };
  }
}

export async function adminSuspendUserAction(targetUserId: string): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.adminSuspendUser, { adminId, targetUserId });
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'UNKNOWN' };
  }
}

export async function adminChangeUserRoleAction(
  targetUserId: string,
  newRole: 'couple' | 'pro' | 'guest' | 'admin',
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.adminChangeUserRole, { adminId, targetUserId, newRole });
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'UNKNOWN' };
  }
}

export type UserDeletionPreview = {
  label: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  role: 'couple' | 'pro' | 'guest' | 'admin';
  counts: {
    organizations: number;
    events: number;
    reassignedEvents: number;
    guests: number;
    photos: number;
    payments: number;
    succeededPayments: number;
  };
  detachedAffiliateCodes: string[];
  blockers: { isAdmin: boolean; billedOrgs: string[]; teamOrgs: string[] };
};

/** Inventaire de ce qu'une suppression emporterait — lu à l'ouverture de la modale. */
export async function adminUserDeletionPreviewAction(
  targetUserId: string,
): Promise<{ ok: true; preview: UserDeletionPreview } | { ok: false; error: string }> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const preview = await convex.query(convexApi.adminUserDeletionPreview, {
      adminId,
      targetUserId,
    });
    if (!preview) return { ok: false, error: 'USER_NOT_FOUND' };
    return { ok: true, preview };
  } catch (e: unknown) {
    return { ok: false, error: deletionErrorCode(e) };
  }
}

/**
 * Supprime définitivement un compte et tout ce qu'il possède.
 *
 * `confirmLabel` est retapé par l'admin et revalidé côté Convex : le contrôle
 * ne peut pas vivre dans l'écran seul, une suppression en cascade n'ayant pas
 * de retour en arrière.
 */
export async function adminDeleteUserAction(
  targetUserId: string,
  confirmLabel: string,
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.adminDeleteUser, { adminId, targetUserId, confirmLabel });
    revalidatePath('/admin/users');
    revalidatePath('/admin/events');
    revalidatePath('/admin/affiliates');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: deletionErrorCode(e) };
  }
}

export async function adminUpdateEventStatusAction(
  eventId: string,
  newStatus: 'draft' | 'active' | 'archived' | 'cancelled',
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.adminUpdateEventStatus, { adminId, eventId, newStatus });
    revalidatePath('/admin/events');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'UNKNOWN' };
  }
}

export async function adminDeleteEventAction(eventId: string): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.adminDeleteEvent, { adminId, eventId });
    revalidatePath('/admin/events');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'UNKNOWN' };
  }
}

export async function adminModeratePhotoAction(
  photoId: string,
  decision: 'approved' | 'rejected',
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.adminModeratePhoto, { adminId, photoId, decision });
    revalidatePath('/admin/moderation');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'UNKNOWN' };
  }
}

/* -------------------------------------------------------------------------- */
/*  Remboursements (paiements one-shot plateforme)                             */
/* -------------------------------------------------------------------------- */

export type RefundResult =
  | { ok: true; status: string; refundedAmountMinor: number }
  | { ok: false; error: string };

/**
 * Rembourse un paiement plateforme. Séquence : (1) garde admin, (2) lit les
 * infos Stripe du paiement via Convex, (3) appelle Stripe (total ou partiel),
 * (4) enregistre le résultat + audit via Convex. `amountMinor` omis = total.
 * Pour les paiements `mock` (dev), saute Stripe et marque directement remboursé.
 */
export async function adminRefundPaymentAction(
  paymentId: string,
  amountMinor?: number,
): Promise<RefundResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const info = await convex.query(convexApi.adminGetPaymentRefundInfo, { adminId, paymentId });

    if (info.status !== 'succeeded' && info.status !== 'partially_refunded') {
      return { ok: false, error: 'NOT_REFUNDABLE' };
    }
    const remaining = info.amountMinor - info.refundedAmountMinor;
    if (remaining <= 0) return { ok: false, error: 'ALREADY_FULLY_REFUNDED' };

    const requested = amountMinor ?? remaining;
    if (requested <= 0 || requested > remaining) return { ok: false, error: 'INVALID_AMOUNT' };
    const isFull = requested >= remaining;

    let stripeRefundId: string | undefined;
    let appliedAmount = requested;

    if (info.provider === 'stripe') {
      const res = await refundPlatformPayment(
        info.providerSessionId,
        isFull ? undefined : requested,
      );
      stripeRefundId = res.id;
      appliedAmount = res.amountMinor;
    }

    const marked = await convex.mutation(convexApi.adminMarkPaymentRefunded, {
      adminId,
      paymentId,
      refundAmountMinor: appliedAmount,
      // Cumul calculé sur l'état lu AVANT l'appel Stripe : entre-temps le
      // webhook `charge.refunded` a pu écrire le même champ, et additionner
      // l'incrément par-dessus doublerait le total.
      totalRefundedMinor: info.refundedAmountMinor + appliedAmount,
      stripeRefundId,
    });

    revalidatePath('/admin/payments');
    revalidatePath('/admin/invoices');
    revalidatePath('/admin');
    return { ok: true, status: marked.status, refundedAmountMinor: appliedAmount };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/* -------------------------------------------------------------------------- */
/*  Abonnements (annuler / réactiver / factures)                               */
/* -------------------------------------------------------------------------- */

export async function adminCancelSubscriptionAction(
  organizationId: string,
  mode: 'period_end' | 'immediate',
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const info = await convex.query(convexApi.adminGetOrgSubscriptionInfo, {
      adminId,
      organizationId,
    });
    if (!info.stripeSubscriptionId) return { ok: false, error: 'NO_SUBSCRIPTION' };

    await cancelPlatformSubscription(info.stripeSubscriptionId, mode);
    await convex.mutation(convexApi.adminMarkSubscriptionCanceled, {
      adminId,
      organizationId,
      mode,
    });

    revalidatePath('/admin/subscriptions');
    revalidatePath('/admin');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export async function adminReactivateSubscriptionAction(
  organizationId: string,
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const info = await convex.query(convexApi.adminGetOrgSubscriptionInfo, {
      adminId,
      organizationId,
    });
    if (!info.stripeSubscriptionId) return { ok: false, error: 'NO_SUBSCRIPTION' };

    await reactivatePlatformSubscription(info.stripeSubscriptionId);
    await convex.mutation(convexApi.adminMarkSubscriptionReactivated, { adminId, organizationId });

    revalidatePath('/admin/subscriptions');
    revalidatePath('/admin');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export type OrgInvoicesResult =
  | { ok: true; invoices: SubscriptionInvoice[]; orgName: string }
  | { ok: false; error: string };

/**
 * Liste les factures d'abonnement Stripe d'une organisation (lecture, pour le
 * Dialog « Voir les factures »). Renvoie `[]` si pas de client Stripe.
 */
export async function adminListOrgInvoicesAction(
  organizationId: string,
): Promise<OrgInvoicesResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const info = await convex.query(convexApi.adminGetOrgSubscriptionInfo, {
      adminId,
      organizationId,
    });
    if (!info.stripeCustomerId) return { ok: true, invoices: [], orgName: info.name };
    const invoices = await listSubscriptionInvoices(info.stripeCustomerId, 24);
    return { ok: true, invoices, orgName: info.name };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/* -------------------------------------------------------------------------- */
/*  Promotions — coupons, codes promo & remises (gestes commerciaux)           */
/* -------------------------------------------------------------------------- */

export type PromotionsResult =
  | { ok: true; coupons: AdminCoupon[]; promoCodes: AdminPromotionCode[] }
  | { ok: false; error: string };

export async function adminListPromotionsAction(): Promise<PromotionsResult> {
  try {
    await requireAdmin();
    const [coupons, promoCodes] = await Promise.all([listCoupons(), listPromotionCodes()]);
    return { ok: true, coupons, promoCodes };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export type CreateCouponInput = {
  name: string;
  // `trial` = mois offerts : coupon 100 % pendant `trialMonths` mois. C'est le
  // seul mécanisme Stripe qui offre des mois gratuits via un CODE PROMO saisi au
  // checkout (le trial natif ne s'attache pas à un code). Toujours réservé aux
  // forfaits pros (abonnement récurrent) — voir `adminCreateCouponAction`.
  kind: 'percent' | 'amount' | 'trial';
  percentOff?: number;
  amountOffMajor?: number; // saisi en unité majeure (€), converti en minor
  currency?: Currency;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths?: number;
  // Nombre de mois offerts pour un essai (`kind === 'trial'`).
  trialMonths?: number;
  maxRedemptions?: number;
  redeemBy?: number; // ms epoch
  // Génère aussi un code promo lisible rattaché au coupon.
  promoCode?: string;
  // Restreint le coupon aux forfaits pros (Starter/Business/Agency, mensuel +
  // annuel) — ne s'applique alors ni aux forfaits couples ni au PAYG.
  restrictToProProducts?: boolean;
};

export async function adminCreateCouponAction(input: CreateCouponInput): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();

    const isTrial = input.kind === 'trial';

    // Essai gratuit = coupon 100 % pendant N mois (duration `repeating`). Card on
    // file au checkout, N mois à 0 €, puis le tarif normal de l'abonnement reprend.
    if (isTrial && (input.trialMonths == null || input.trialMonths < 1)) {
      return { ok: false, error: 'TRIAL_NEEDS_MONTHS' };
    }

    const percentOff = isTrial ? 100 : input.kind === 'percent' ? input.percentOff : undefined;
    const amountOffMinor =
      input.kind === 'amount' && input.amountOffMajor != null
        ? Math.round(input.amountOffMajor * 100)
        : undefined;
    const duration = isTrial ? ('repeating' as const) : input.duration;
    const durationInMonths = isTrial ? input.trialMonths : input.durationInMonths;

    // Restriction « forfaits pros » : on résout les produits Stripe des abos
    // pros dans l'environnement courant. Si aucun n'est résolu (env vars prix
    // manquantes), on refuse plutôt que de créer par erreur un coupon sans
    // restriction (qui s'appliquerait aussi aux forfaits couples).
    //
    // Forcée pour un essai : un coupon récurrent 100 % appliqué à un forfait
    // couple / PAYG one-shot offrirait le forfait entier — un essai n'a de sens
    // que sur un abonnement pro mensuel.
    const restrictToPro = Boolean(input.restrictToProProducts) || isTrial;
    let appliesToProducts: string[] | undefined;
    if (restrictToPro) {
      appliesToProducts = await resolveProPlanProductIds();
      if (appliesToProducts.length === 0) {
        return { ok: false, error: 'NO_PRO_PRODUCTS_RESOLVED' };
      }
    }

    const coupon = await createCoupon({
      name: input.name,
      percentOff,
      amountOffMinor,
      currency: input.currency,
      duration,
      durationInMonths,
      maxRedemptions: input.maxRedemptions,
      redeemBy: input.redeemBy,
      appliesToProducts,
    });

    let promoCode: string | undefined;
    if (input.promoCode) {
      const pc = await createPromotionCode({ couponId: coupon.id, code: input.promoCode });
      promoCode = pc.code;
    }

    await convex.mutation(convexApi.adminLogAction, {
      adminId,
      action: 'create_coupon',
      targetType: 'coupon',
      targetId: coupon.id,
      details: JSON.stringify({
        name: input.name,
        kind: input.kind,
        promoCode,
        ...(isTrial ? { trialMonths: input.trialMonths } : {}),
        ...(restrictToPro ? { restrictToProProducts: true } : {}),
      }),
    });
    revalidatePath('/admin/promotions');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export async function adminDeleteCouponAction(couponId: string): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await deleteCoupon(couponId);
    await convex.mutation(convexApi.adminLogAction, {
      adminId,
      action: 'delete_coupon',
      targetType: 'coupon',
      targetId: couponId,
    });
    revalidatePath('/admin/promotions');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export async function adminCreatePromotionCodeAction(input: {
  couponId: string;
  code?: string;
  maxRedemptions?: number;
  expiresAt?: number;
  restrictToFirstTime?: boolean;
}): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const pc = await createPromotionCode(input);
    await convex.mutation(convexApi.adminLogAction, {
      adminId,
      action: 'create_promo_code',
      targetType: 'coupon',
      targetId: input.couponId,
      details: JSON.stringify({ code: pc.code }),
    });
    revalidatePath('/admin/promotions');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export async function adminSetPromotionCodeActiveAction(
  promotionCodeId: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await setPromotionCodeActive(promotionCodeId, active);
    await convex.mutation(convexApi.adminLogAction, {
      adminId,
      action: active ? 'enable_promo_code' : 'disable_promo_code',
      targetType: 'coupon',
      targetId: promotionCodeId,
    });
    revalidatePath('/admin/promotions');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/** Applique une remise (coupon) à l'abonnement d'une organisation — geste commercial. */
export async function adminApplyDiscountToOrgAction(
  organizationId: string,
  couponId: string,
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const info = await convex.query(convexApi.adminGetOrgSubscriptionInfo, {
      adminId,
      organizationId,
    });
    if (!info.stripeSubscriptionId) return { ok: false, error: 'NO_SUBSCRIPTION' };
    await applyCouponToSubscription(info.stripeSubscriptionId, couponId);
    await convex.mutation(convexApi.adminLogAction, {
      adminId,
      action: 'apply_discount',
      targetType: 'discount',
      targetId: organizationId,
      details: JSON.stringify({ couponId }),
    });
    revalidatePath('/admin/subscriptions');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export async function adminRemoveOrgDiscountAction(organizationId: string): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const info = await convex.query(convexApi.adminGetOrgSubscriptionInfo, {
      adminId,
      organizationId,
    });
    if (!info.stripeSubscriptionId) return { ok: false, error: 'NO_SUBSCRIPTION' };
    await removeSubscriptionDiscount(info.stripeSubscriptionId);
    await convex.mutation(convexApi.adminLogAction, {
      adminId,
      action: 'remove_discount',
      targetType: 'discount',
      targetId: organizationId,
    });
    revalidatePath('/admin/subscriptions');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/* -------------------------------------------------------------------------- */
/*  Newsletter — campagnes (composer + envoyer via SES)                        */
/* -------------------------------------------------------------------------- */

export type NewsletterCampaign = {
  _id: string;
  subject: string;
  status: 'sending' | 'sent' | 'failed';
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: number;
  sentAt?: number;
};

export async function adminListNewsletterCampaignsAction(): Promise<
  { ok: true; campaigns: NewsletterCampaign[] } | { ok: false; error: string }
> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const campaigns = await convex.query(convexApi.newsletterListCampaigns, { adminId });
    return { ok: true, campaigns };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/** Envoi de TEST : envoie la campagne à l'email de l'admin connecté uniquement. */
export async function adminSendNewsletterTestAction(
  subject: string,
  bodyText: string,
): Promise<{ ok: true; recipient: string } | { ok: false; error: string }> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const me = await convex.query(convexApi.currentUser, { userId: adminId });
    const testEmail = me?.email;
    if (!testEmail) return { ok: false, error: 'NO_ADMIN_EMAIL' };

    const res = await convex.action(convexApi.newsletterSendCampaign, {
      adminId,
      subject,
      bodyText,
      testEmail,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, recipient: res.test ? res.recipient : testEmail };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/** Envoi RÉEL à tous les abonnés actifs. Outward/irréversible — confirmé côté UI. */
export async function adminSendNewsletterAction(
  subject: string,
  bodyText: string,
): Promise<{ ok: true; sentCount: number; failedCount: number } | { ok: false; error: string }> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const res = await convex.action(convexApi.newsletterSendCampaign, {
      adminId,
      subject,
      bodyText,
    });
    if (!res.ok) return { ok: false, error: res.error };
    if (res.test) return { ok: false, error: 'UNEXPECTED_TEST_MODE' };
    revalidatePath('/admin/newsletter');
    return { ok: true, sentCount: res.sentCount, failedCount: res.failedCount };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export async function adminUpdatePhotoBookStatusAction(
  orderId: string,
  status: 'requested' | 'in_production' | 'shipped' | 'cancelled',
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.adminUpdatePhotoBookStatus, { adminId, orderId, status });
    revalidatePath('/admin/photo-books');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/* -------------------------------------------------------------------------- */
/*  Rapports de bug — triage                                                  */
/* -------------------------------------------------------------------------- */

export async function adminUpdateBugStatusAction(
  reportId: string,
  status: 'open' | 'triaged' | 'resolved',
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    await getConvexServerClient().mutation(convexApi.updateBugReportStatus, {
      requesterId: adminId,
      reportId,
      status,
    });
    revalidatePath('/admin/bug-reports');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/** Récupère la capture (data URL) d'un rapport à la demande (exclue de la liste). */
export async function adminGetBugScreenshotAction(
  reportId: string,
): Promise<{ ok: true; screenshot: string | null } | { ok: false; error: string }> {
  try {
    const adminId = await requireAdmin();
    const report = await getConvexServerClient().query(convexApi.getBugReport, {
      requesterId: adminId,
      reportId,
    });
    return { ok: true, screenshot: report?.screenshot ?? null };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/* -------------------------------------------------------------------------- */
/*  Affiliation — création d'affilié (invitation-only) + activation           */
/* -------------------------------------------------------------------------- */

/**
 * Crée le coupon Stripe + le code promo d'un affilié, sous SON code exact.
 *
 * C'est ce qui rend le code réellement partageable : jusqu'ici `buyerDiscountBps`
 * ne s'appliquait qu'aux acheteurs venus par le lien `?ref=`, et l'audience qui
 * tapait le code au checkout se le voyait refuser.
 *
 * Le coupon est restreint aux PRODUITS COUPLE — sans ça, le code d'une
 * créatrice remiserait aussi un abonnement pro (leurs checkouts ouvrent eux
 * aussi le champ code promo). La restriction étant immuable côté Stripe, on
 * refuse plutôt que de créer un coupon trop large.
 */
async function createPartnerCouponForAffiliate(
  adminId: string,
  affiliateId: string,
  affiliate: { code: string; buyerDiscountBps: number; displayName?: string | null },
): Promise<{ shareCode: string } | null> {
  const plan = partnerCouponPlan({
    code: affiliate.code,
    buyerDiscountBps: affiliate.buyerDiscountBps,
    displayName: affiliate.displayName ?? null,
    now: Date.now(),
  });
  // Aucune remise configurée → rien à partager, le lien suffit à attribuer.
  if (!plan) return null;

  // Anti-doublon : deux codes promo de même chaîne rendraient l'attribution
  // ambiguë (on ne saurait plus quel affilié créditer).
  //
  // Sauf s'il s'agit du NÔTRE, laissé derrière par un échec entre Stripe et
  // Convex (le coupon et le code existaient, l'enregistrement des ids avait
  // échoué). Ce cas-là condamnait le partenaire : « Créer le code » retombait
  // indéfiniment sur ce garde, et seule une suppression manuelle au Dashboard
  // Stripe en sortait. On l'adopte plutôt, la metadata faisant foi.
  const clash = await findPromotionCodeByCode(affiliate.code);
  if (clash) {
    const existingCoupon = clash.couponId ? await retrieveCoupon(clash.couponId) : null;
    const ours =
      existingCoupon?.metadata.wedillybird === 'partner_code' &&
      existingCoupon.metadata.wedillybird_affiliate_code === affiliate.code;
    if (!ours) throw new Error('STRIPE_CODE_ALREADY_EXISTS');
    // Adopter n'a de sens que si le code est ENCORE utilisable et au bon taux.
    // Sinon on enregistrerait un `stripePromotionCodeId` qui rendrait
    // `partnerDashboard.shareable` vrai pour un code que le checkout refuse —
    // et plus rien ne permettrait de le corriger, « Créer le code » retombant
    // dès lors sur `CODE_ALREADY_CREATED`. On préfère renvoyer l'admin au
    // Dashboard Stripe, qui est le seul endroit où l'état se répare.
    const stale =
      !clash.active ||
      (clash.expiresAt != null && clash.expiresAt <= Date.now()) ||
      existingCoupon.percentOff !== plan.percentOff;
    if (stale) throw new Error('STRIPE_CODE_STALE');
    await getConvexServerClient().mutation(convexApi.setAffiliateStripeCoupon, {
      adminId,
      affiliateId,
      stripeCouponId: existingCoupon.id,
      stripePromotionCodeId: clash.id,
    });
    return { shareCode: clash.code };
  }

  const appliesToProducts = await resolveConsumerPlanProductIds();
  if (appliesToProducts.length === 0) throw new Error('NO_CONSUMER_PRODUCTS_RESOLVED');

  const coupon = await createCoupon({
    name: plan.name,
    percentOff: plan.percentOff,
    duration: 'once',
    redeemBy: plan.redeemBy,
    appliesToProducts,
    metadata: plan.metadata,
  });
  // Pas de `restrictToFirstTime` ici, contrairement à
  // `scripts/create-affiliate-code.ts` : un code partenaire doit marcher pour
  // TOUTE l'audience de la créatrice. Chaque réutilisation est une vente réelle
  // qui génère sa commission — c'est le programme qui fonctionne, pas un abus.
  let promo: Awaited<ReturnType<typeof createPromotionCode>>;
  try {
    promo = await createPromotionCode({
      couponId: coupon.id,
      code: affiliate.code,
      expiresAt: plan.redeemBy,
    });
  } catch (e: unknown) {
    // Un coupon sans code promo n'est atteignable par personne, et il ferait
    // rater l'anti-doublon du prochain « Créer le code » : on le retire pour
    // que le rattrapage reparte d'un état propre plutôt que d'empiler.
    try {
      await deleteCoupon(coupon.id);
    } catch {
      // Stripe indisponible — le coupon orphelin se nettoie au Dashboard.
    }
    throw e;
  }

  await getConvexServerClient().mutation(convexApi.setAffiliateStripeCoupon, {
    adminId,
    affiliateId,
    stripeCouponId: coupon.id,
    stripePromotionCodeId: promo.id,
  });
  return { shareCode: promo.code };
}

/**
 * Crée le lien d'invitation d'un partenaire — « voici ton compte, offert
 * offerts, sans carte ».
 *
 * Créer un nouveau lien révoque le précédent côté Convex : deux liens vivants
 * pour un même partenariat, ce sont deux comptes agence offerts. Regénérer un
 * lien perdu doit rester trivial, mais jamais cumulatif.
 */
/**
 * Rattache un affilié à un compte utilisateur (ou l'en détache).
 *
 * C'est ce rattachement qui rend l'espace `/partenaire` atteignable :
 * `partnerDashboard` scope sur `by_owner`, donc sans `ownerUserId` un
 * partenaire a un code qui rapporte et aucune page pour le constater.
 */
export async function adminSetAffiliateOwnerAction(
  affiliateId: string,
  ownerUserId: string | null,
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.setAffiliateOwner, { adminId, affiliateId, ownerUserId });
    revalidatePath('/admin/users');
    revalidatePath('/admin/affiliates');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export async function adminCreatePartnerInviteAction(
  affiliateId: string,
  input?: {
    inviteeEmail?: string;
    inviteeName?: string;
    kind?: 'pro' | 'couple';
    /** Palier agence offert. Omis ⇒ `DEFAULT_PARTNER_COMP_TIER`. */
    grantTier?: 'starter' | 'business' | 'agency';
    /** Durée du compte agence offert, en mois. Omise ⇒ `DEFAULT_PARTNER_COMP_MONTHS`. */
    grantMonths?: number;
    /** Forfait particulier offert. Omis ⇒ `DEFAULT_COMPED_EVENT_PLAN`. */
    grantEventTier?: 'essential' | 'premium';
  },
): Promise<ActionResult & { token?: string }> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    // Chaque champ n'est transmis que s'il est fourni : c'est le serveur qui
    // porte les défauts, et les recopier ici en ferait une seconde source.
    const res = await convex.mutation(convexApi.createPartnerInvite, {
      adminId,
      affiliateId,
      ...(input?.inviteeEmail ? { inviteeEmail: input.inviteeEmail } : {}),
      ...(input?.inviteeName ? { inviteeName: input.inviteeName } : {}),
      ...(input?.kind ? { kind: input.kind } : {}),
      ...(input?.grantTier ? { grantTier: input.grantTier } : {}),
      ...(input?.grantMonths ? { grantMonths: input.grantMonths } : {}),
      ...(input?.grantEventTier ? { grantEventTier: input.grantEventTier } : {}),
    });
    revalidatePath('/admin/affiliates');
    return { ok: true, token: res.token };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Envoie le lien d'invitation au partenaire.
 *
 * `action` et non `mutation` : l'envoi SES passe par une action Node côté
 * Convex. Le contrôle du rôle admin est refait là-bas, sur le ctx qui voit la
 * base — celui d'ici ne protège que l'appel.
 */
export async function adminSendPartnerInviteAction(
  inviteId: string,
  to?: string,
): Promise<ActionResult & { to?: string }> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const res = await convex.action(convexApi.sendPartnerInvite, {
      adminId,
      inviteId,
      ...(to ? { to } : {}),
    });
    if (!res.ok) return { ok: false, error: res.error };
    revalidatePath('/admin/affiliates');
    return { ok: true, to: res.to };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/** Coupe un lien encore inutilisé. Un lien déjà consommé n'est pas révocable. */
export async function adminRevokePartnerInviteAction(inviteId: string): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.revokePartnerInvite, {
      adminId,
      inviteId,
    });
    revalidatePath('/admin/affiliates');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export async function adminCreateAffiliateAction(input: {
  code: string;
  kind: 'referral' | 'partner';
  rewardType: 'credit' | 'cash';
  rateBps: number;
  buyerDiscountBps: number;
  ownerEmail?: string;
  displayName?: string;
}): Promise<ActionResult & { couponError?: string }> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const created = await convex.mutation(convexApi.createAffiliate, {
      adminId,
      code: input.code,
      kind: input.kind,
      rewardType: input.rewardType,
      rateBps: input.rateBps,
      buyerDiscountBps: input.buyerDiscountBps,
      ...(input.ownerEmail ? { ownerEmail: input.ownerEmail } : {}),
      ...(input.displayName ? { displayName: input.displayName } : {}),
    });

    // Le coupon Stripe est un EFFET DE BORD de la création, jamais un
    // pré-requis : si Stripe échoue, l'affilié existe et son lien attribue
    // déjà. On remonte l'échec pour que l'admin relance (« Créer le code »)
    // plutôt que de perdre l'affilié en rollback.
    let couponError: string | undefined;
    try {
      await createPartnerCouponForAffiliate(adminId, created.id, {
        code: created.code,
        buyerDiscountBps: input.buyerDiscountBps,
        displayName: input.displayName ?? null,
      });
    } catch (e: unknown) {
      couponError = msg(e);
    }

    revalidatePath('/admin/affiliates');
    return couponError ? { ok: true, couponError } : { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Crée (ou recrée) le code partageable d'un affilié existant — rattrapage
 * après un échec Stripe, et chemin de migration pour les affiliés ouverts
 * avant que la création automatique n'existe.
 */
export async function adminEnsureAffiliateCouponAction(affiliateId: string): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const affiliate = await convex.query(convexApi.getAffiliateForAdmin, { adminId, affiliateId });
    if (!affiliate) return { ok: false, error: 'AFFILIATE_NOT_FOUND' };
    if (affiliate.stripePromotionCodeId) return { ok: false, error: 'CODE_ALREADY_CREATED' };

    const result = await createPartnerCouponForAffiliate(adminId, affiliateId, {
      code: affiliate.code,
      buyerDiscountBps: affiliate.buyerDiscountBps,
      displayName: affiliate.displayName,
    });
    if (!result) return { ok: false, error: 'NO_BUYER_DISCOUNT' };
    revalidatePath('/admin/affiliates');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export async function adminSetAffiliateStatusAction(
  affiliateId: string,
  status: 'active' | 'disabled',
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const before = await convex.query(convexApi.getAffiliateForAdmin, { adminId, affiliateId });
    await convex.mutation(convexApi.setAffiliateStatus, { adminId, affiliateId, status });

    // Le code promo Stripe suit l'affilié : désactiver l'un sans l'autre
    // laisserait une remise encaissable alors que la commission ne serait plus
    // créditée (`applyReferral` refuse un affilié `disabled`) — on offrirait la
    // remise sans rien tracer. Best-effort : le ledger fait foi.
    if (before?.stripePromotionCodeId) {
      try {
        await setPromotionCodeActive(before.stripePromotionCodeId, status === 'active');
      } catch {
        // Stripe indisponible — l'état Convex reste la source de vérité.
      }
    }
    revalidatePath('/admin/affiliates');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Efface définitivement un affilié — le code redevient libre.
 *
 * Convex refuse dès qu'une commission existe (le ledger est comptable), donc
 * l'appel part EN PREMIER : nettoyer Stripe d'abord reviendrait à couper la
 * remise d'un partenaire actif sur une suppression qui sera refusée.
 *
 * Stripe suit ensuite, en best-effort : code promo désactivé puis coupon
 * supprimé. Un échec n'annule pas la suppression — il est remonté, parce qu'un
 * code promo resté actif reste saisissable au checkout alors que plus rien ne
 * l'attribue.
 */
export async function adminDeleteAffiliateAction(
  affiliateId: string,
): Promise<ActionResult & { stripeError?: string }> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    const deleted = await convex.mutation(convexApi.deleteAffiliate, { adminId, affiliateId });

    let stripeError: string | undefined;
    try {
      if (deleted.stripePromotionCodeId) {
        await setPromotionCodeActive(deleted.stripePromotionCodeId, false);
      }
      if (deleted.stripeCouponId) await deleteCoupon(deleted.stripeCouponId);
    } catch (e: unknown) {
      stripeError = msg(e);
    }

    revalidatePath('/admin/affiliates');
    revalidatePath('/admin/users');
    return stripeError ? { ok: true, stripeError } : { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: deletionErrorCode(e) };
  }
}

/**
 * Marque une commission comme VERSÉE (après virement réel au partenaire).
 * `markReferralPaid` est idempotente et journalise dans l'audit — c'est la
 * seule sortie de `vested` pour une commission cash.
 */
export async function adminMarkReferralPaidAction(
  referralId: string,
  payoutReference?: string,
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.markReferralPaid, {
      adminId,
      referralId,
      ...(payoutReference ? { payoutReference } : {}),
    });
    revalidatePath('/admin/affiliates');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

/* -------------------------------------------------------------------------- */
/*  Forfait offert — partenariat, geste commercial, compte de démo            */
/* -------------------------------------------------------------------------- */

export async function adminGrantEventPlanAction(
  eventId: string,
  /** Omis ⇒ le défaut serveur (`DEFAULT_COMPED_EVENT_PLAN`, soit Premium). */
  planTier?: 'essential' | 'premium',
  reason?: string,
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.adminGrantEventPlan, {
      adminId,
      eventId,
      ...(planTier ? { planTier } : {}),
      ...(reason ? { reason } : {}),
    });
    revalidatePath('/admin/events');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}

export async function adminRevokeEventPlanAction(
  eventId: string,
  reason?: string,
): Promise<ActionResult> {
  try {
    const adminId = await requireAdmin();
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.adminRevokeEventPlan, {
      adminId,
      eventId,
      ...(reason ? { reason } : {}),
    });
    revalidatePath('/admin/events');
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: msg(e) };
  }
}
