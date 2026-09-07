/**
 * Calcul des analytics plateforme (dashboard super admin) — **fonction pure**,
 * isolée du runtime Convex pour être testable unitairement (cf.
 * `tests/unit/convex/platform-analytics.test.ts`). La query `admin:platformAnalytics`
 * se contente de `collect()` les tables puis de déléguer ici.
 *
 * Volontairement typé sur des formes légères (pas `Doc<…>`) : seuls les champs
 * utilisés sont requis, et les Docs Convex y sont assignables structurellement.
 */

export type AnalyticsUser = { role: string; createdAt: number };
export type AnalyticsEvent = {
  _id: string;
  status: string;
  planTier?: string;
  eventDate: number;
  createdAt: number;
  maxGuests: number;
};
export type AnalyticsPayment = {
  eventId: string;
  status: string;
  amountMinor: number;
  refundedAmountMinor?: number;
  createdAt: number;
  updatedAt: number;
};
export type AnalyticsOrg = {
  subscriptionTier?: string;
  subscriptionStatus?: string;
  /** Compte offert : jamais un client, même si un tier lui est posé. */
  compedSubscription?: { expiresAt: number } | null;
};

export interface AnalyticsInput {
  users: AnalyticsUser[];
  events: AnalyticsEvent[];
  payments: AnalyticsPayment[];
  orgs: AnalyticsOrg[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Médiane (0 si vide). N'altère pas le tableau d'entrée. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function computePlatformAnalytics(
  { users, events, payments, orgs }: AnalyticsInput,
  now: number,
) {
  const succeeded = payments.filter(
    (p) => p.status === 'succeeded' || p.status === 'partially_refunded',
  );

  // --- Funnel particuliers : compte couple → event → publication → checkout → payé
  const couplesSignedUp = users.filter((u) => u.role === 'couple').length;
  const eventsCreated = events.length;
  const eventsPublished = events.filter(
    (e) => e.status === 'active' || e.status === 'archived',
  ).length;
  const checkoutStarted = new Set(payments.map((p) => p.eventId)).size;
  const paid = new Set(succeeded.map((p) => p.eventId)).size;

  // --- Checkout : statuts d'intent + taux d'abandon
  const byStatus = {
    pending: payments.filter((p) => p.status === 'pending').length,
    succeeded: payments.filter((p) => p.status === 'succeeded').length,
    failed: payments.filter((p) => p.status === 'failed').length,
    cancelled: payments.filter((p) => p.status === 'cancelled').length,
    refunded: payments.filter((p) => p.status === 'refunded' || p.status === 'partially_refunded')
      .length,
  };
  const intentsStarted = payments.length;
  const abandonmentRate =
    intentsStarted > 0 ? (intentsStarted - byStatus.succeeded) / intentsStarted : 0;

  // --- Timing
  const checkoutDurationsMin: number[] = [];
  const createToPayHours: number[] = [];
  const eventCreatedAt = new Map(events.map((e) => [e._id, e.createdAt]));
  for (const p of succeeded) {
    if (p.updatedAt > p.createdAt) checkoutDurationsMin.push((p.updatedAt - p.createdAt) / 60000);
    const evCreated = eventCreatedAt.get(p.eventId);
    if (evCreated && p.updatedAt > evCreated) {
      createToPayHours.push((p.updatedAt - evCreated) / 3_600_000);
    }
  }

  // --- Saisonnalité / rush
  const eventsByEventMonth: Record<string, number> = {};
  const eventsByCreatedMonth: Record<string, number> = {};
  const eventsByWeekday = [0, 0, 0, 0, 0, 0, 0]; // 0 = dimanche (getUTCDay)
  let upcoming30 = 0;
  let upcoming60 = 0;
  let upcoming90 = 0;
  for (const e of events) {
    const evMonth = new Date(e.eventDate).toISOString().slice(0, 7);
    eventsByEventMonth[evMonth] = (eventsByEventMonth[evMonth] ?? 0) + 1;
    const crMonth = new Date(e.createdAt).toISOString().slice(0, 7);
    eventsByCreatedMonth[crMonth] = (eventsByCreatedMonth[crMonth] ?? 0) + 1;
    eventsByWeekday[new Date(e.eventDate).getUTCDay()]! += 1;

    const delta = e.eventDate - now;
    if (delta >= 0) {
      if (delta <= 30 * DAY_MS) upcoming30 += 1;
      if (delta <= 60 * DAY_MS) upcoming60 += 1;
      if (delta <= 90 * DAY_MS) upcoming90 += 1;
    }
  }

  // --- Mix d'offres
  const planMix = {
    essential: events.filter((e) => e.planTier === 'essential').length,
    premium: events.filter((e) => e.planTier === 'premium').length,
  };
  // Un compte offert porte un `subscriptionTier` — il le faut, sinon son quota
  // d'événements serait illimité — mais ce n'est pas un client. Le compter dans
  // le mix ferait lire un cadeau comme une vente ; il a son propre compteur.
  const compedOrgs = orgs.filter((o) => Boolean(o.compedSubscription));
  const payingOrgs = orgs.filter((o) => !o.compedSubscription);
  const proTierMix = {
    starter: payingOrgs.filter((o) => o.subscriptionTier === 'starter').length,
    business: payingOrgs.filter((o) => o.subscriptionTier === 'business').length,
    agency: payingOrgs.filter((o) => o.subscriptionTier === 'agency').length,
    comped: compedOrgs.length,
  };
  const guestCounts = events.map((e) => e.maxGuests).filter((n) => n > 0);
  const avgGuests =
    guestCounts.length > 0
      ? Math.round(guestCounts.reduce((s, n) => s + n, 0) / guestCounts.length)
      : 0;
  const totalRevenueMinor = succeeded.reduce((s, p) => s + p.amountMinor, 0);
  const aovMinor = succeeded.length > 0 ? Math.round(totalRevenueMinor / succeeded.length) : 0;

  // --- Tendance 30 j vs 30 j précédents
  const last30Start = now - 30 * DAY_MS;
  const prev30Start = now - 60 * DAY_MS;
  let paidLast30 = 0;
  let paidPrev30 = 0;
  let revenueLast30Minor = 0;
  let revenuePrev30Minor = 0;
  let newEventsLast30 = 0;
  let newEventsPrev30 = 0;
  for (const p of succeeded) {
    if (p.updatedAt >= last30Start) {
      paidLast30 += 1;
      revenueLast30Minor += p.amountMinor;
    } else if (p.updatedAt >= prev30Start) {
      paidPrev30 += 1;
      revenuePrev30Minor += p.amountMinor;
    }
  }
  for (const e of events) {
    if (e.createdAt >= last30Start) newEventsLast30 += 1;
    else if (e.createdAt >= prev30Start) newEventsPrev30 += 1;
  }

  // --- Abonnements pro + MRR par tier (miroir grille v2)
  const tierMrr: Record<string, number> = { starter: 9900, business: 21900, agency: 44900 };
  const subStatus = {
    active: orgs.filter((o) => o.subscriptionStatus === 'active').length,
    trialing: orgs.filter((o) => o.subscriptionStatus === 'trialing').length,
    past_due: orgs.filter((o) => o.subscriptionStatus === 'past_due').length,
    canceled: orgs.filter((o) => o.subscriptionStatus === 'canceled').length,
    unpaid: orgs.filter((o) => o.subscriptionStatus === 'unpaid').length,
  };
  const mrrByTierMinor = { starter: 0, business: 0, agency: 0 };
  for (const o of orgs) {
    // Ceinture ET bretelles : un cadeau ne pose pas de `subscriptionStatus`,
    // il n'entrerait donc déjà pas ici — mais un revenu fantôme dans le MRR
    // est une erreur qu'on ne voit pas passer, alors on l'exclut aussi par son
    // nom.
    if (o.compedSubscription) continue;
    if (o.subscriptionStatus === 'active' || o.subscriptionStatus === 'trialing') {
      const tier = o.subscriptionTier;
      if (tier === 'starter' || tier === 'business' || tier === 'agency') {
        mrrByTierMinor[tier] += tierMrr[tier]!;
      }
    }
  }

  return {
    funnel: { couplesSignedUp, eventsCreated, eventsPublished, checkoutStarted, paid },
    checkout: { intentsStarted, byStatus, abandonmentRate },
    timing: {
      medianCheckoutMinutes: median(checkoutDurationsMin),
      medianCreateToPayHours: median(createToPayHours),
    },
    seasonality: {
      eventsByEventMonth,
      eventsByCreatedMonth,
      eventsByWeekday,
      upcoming: { next30: upcoming30, next60: upcoming60, next90: upcoming90 },
    },
    mix: { planMix, proTierMix, avgGuests, aovMinor },
    trend: {
      paidLast30,
      paidPrev30,
      revenueLast30Minor,
      revenuePrev30Minor,
      newEventsLast30,
      newEventsPrev30,
    },
    subscriptions: { byStatus: subStatus, mrrByTierMinor },
  };
}

/**
 * Issue d'un remboursement : valide que le cumulé ne dépasse pas le montant, et
 * détermine s'il devient total (`refunded`) ou partiel (`partially_refunded`).
 * Throw `REFUND_EXCEEDS_AMOUNT` si dépassement. Fonction pure (testable).
 */
export function computeRefundOutcome(
  amountMinor: number,
  alreadyRefundedMinor: number,
  refundAmountMinor: number,
): { status: 'refunded' | 'partially_refunded'; totalRefunded: number } {
  const totalRefunded = alreadyRefundedMinor + refundAmountMinor;
  if (totalRefunded > amountMinor) throw new Error('REFUND_EXCEEDS_AMOUNT');
  const isFull = totalRefunded >= amountMinor;
  return { status: isFull ? 'refunded' : 'partially_refunded', totalRefunded };
}
