import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { assertWebhookSecret } from './lib/webhookSecret';
import { internal } from './_generated/api';
import { toIntlTag } from '../lib/i18n/locale-tags';
import { assertOrgRead } from './lib/orgAuth';
import { proTierAtLeast } from './lib/entitlements';
import { MS_PER_DAY, POST_EVENT_UPSELL_RETENTION_DAYS, galleryExpiresAtFor } from './lib/eventPlan';
import {
  applyReferral,
  ensureReferralAffiliate,
  consumeCreditReservation,
  findActiveAffiliateByCode,
  releaseCreditReservation,
} from './affiliate';

function ownerLocaleToIntlTag(locale: string | undefined): string {
  return toIntlTag(locale);
}

const PROVIDER = v.union(v.literal('stripe'), v.literal('mock'));
const CURRENCY = v.union(
  v.literal('EUR'),
  v.literal('USD'),
  v.literal('XOF'),
  v.literal('MAD'),
  v.literal('TND'),
);
const PLAN = v.union(v.literal('essential'), v.literal('premium'));

// Gallery retention is feature-based now: Essentiel = J+30, Premium = J+180.
// Post-event upsell pushes this to J+5y (cf. extendRetentionPostEvent below).
// Règle partagée avec `admin:grantEventPlan` (forfait offert) — cf. lib/eventPlan.

// keep in sync with lib/payments/reconcile.ts
// `convex/` and `lib/` cannot import each other (separate tsconfig projects),
// so the reconciliation logic is duplicated. Both copies must stay aligned.
type ReconciliationPatch = {
  planTier: 'essential' | 'premium';
  paidAt: number;
  galleryExpiresAt: number;
};
function computeEventReconciliation(input: {
  event: {
    planTier?: 'essential' | 'premium';
    paidAt?: number;
    galleryExpiresAt?: number;
    eventDate: number;
  };
  payment: { plan: 'essential' | 'premium' };
  now: number;
}): ReconciliationPatch | null {
  const { event, payment, now } = input;
  const expectedExpiresAt = galleryExpiresAtFor(payment.plan, event.eventDate);
  const needsUpdate =
    event.planTier !== payment.plan ||
    event.paidAt === undefined ||
    event.galleryExpiresAt !== expectedExpiresAt;
  if (!needsUpdate) return null;
  return {
    planTier: payment.plan,
    paidAt: event.paidAt ?? now,
    galleryExpiresAt: expectedExpiresAt,
  };
}

export const recordIntent = mutation({
  args: {
    userId: v.id('users'),
    eventId: v.id('events'),
    plan: PLAN,
    currency: CURRENCY,
    amountMinor: v.number(),
    provider: PROVIDER,
    providerSessionId: v.string(),
    /** Affilié/parrain attribué (résolu du cookie `wdb_ref` au checkout). */
    affiliateId: v.optional(v.id('affiliates')),
    /** Token de réservation du crédit de parrainage appliqué (consommé à la confirmation). */
    creditReservationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error('EVENT_NOT_FOUND');
    if (event.ownerId !== args.userId) throw new Error('FORBIDDEN');

    const id = await ctx.db.insert('payments', {
      userId: args.userId,
      eventId: args.eventId,
      plan: args.plan,
      currency: args.currency,
      amountMinor: args.amountMinor,
      provider: args.provider,
      providerSessionId: args.providerSessionId,
      affiliateId: args.affiliateId,
      creditReservationId: args.creditReservationId,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { id };
  },
});

export const findBySession = query({
  args: { provider: PROVIDER, providerSessionId: v.string() },
  handler: async (ctx, { provider, providerSessionId }) => {
    return ctx.db
      .query('payments')
      .withIndex('by_session', (q) =>
        q.eq('provider', provider).eq('providerSessionId', providerSessionId),
      )
      .first();
  },
});

export const markSucceeded = mutation({
  args: {
    // Secret partagé Vercel ⇄ Convex : cette mutation débloque la galerie
    // payante (réconciliation planTier/paidAt), elle ne doit JAMAIS être
    // appelable directement sur `*.convex.cloud` sans passer par le webhook.
    webhookSecret: v.string(),
    provider: PROVIDER,
    providerSessionId: v.string(),
    providerEventId: v.string(),
    /**
     * Montant RÉELLEMENT encaissé d'après le provider (après coupon / code
     * promo). Base de calcul de la commission d'affiliation — `payment.amountMinor`
     * est le prix catalogue, qui surévaluait la commission dès qu'une remise
     * s'appliquait. Absent (webhook legacy / provider mock) → repli sur le
     * montant du paiement, comportement historique.
     */
    netMinor: v.optional(v.number()),
    /**
     * Assiette HORS TAXES de la commission d'affiliation, calculée côté app
     * (`lib/payments/vat.ts`, la même règle que les factures). La TVA n'étant
     * pas un revenu, la commissionner reviendrait à payer le partenaire dessus.
     * Absente → repli sur `netMinor`.
     */
    commissionBaseMinor: v.optional(v.number()),
    /**
     * Code promo saisi au checkout. Rattrape l'attribution quand l'acheteur a
     * TAPÉ le code d'un partenaire au lieu de cliquer son lien `?ref=` (aucun
     * cookie `wdb_ref` → aucun `affiliateId` sur le paiement).
     */
    promotionCode: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      webhookSecret,
      provider,
      providerSessionId,
      providerEventId,
      netMinor,
      commissionBaseMinor,
      promotionCode,
    },
  ) => {
    assertWebhookSecret(webhookSecret);
    const payment = await ctx.db
      .query('payments')
      .withIndex('by_session', (q) =>
        q.eq('provider', provider).eq('providerSessionId', providerSessionId),
      )
      .first();
    if (!payment) throw new Error('PAYMENT_NOT_FOUND');

    const alreadyApplied = payment.status === 'succeeded';
    const now = Date.now();

    if (!alreadyApplied) {
      await ctx.db.patch(payment._id, {
        status: 'succeeded',
        providerEventId,
        updatedAt: now,
      });
    }

    // Self-healing event reconciliation: even when the payment is already
    // marked `succeeded`, the corresponding event document may have been left
    // in an inconsistent state (e.g. `planTier` set but `paidAt` /
    // `galleryExpiresAt` missing because of a partial earlier write or a bug
    // in a previous webhook handler). We always attempt to bring the event
    // back in line with the payment's plan — but only patch when something
    // actually diverges, to avoid spurious `updatedAt` churn.
    const event = await ctx.db.get(payment.eventId);
    // Réconciliation réservée aux paiements de forfait. Un upsell HD
    // (`kind: 'post_event_upsell'`, sans `plan`) ne passe jamais par ce
    // chemin — il est appliqué par `applyPostEventUpsell` — mais on garde
    // la condition défensive pour la cohérence des types (`plan` optionnel).
    if (event && payment.plan) {
      const patch = computeEventReconciliation({
        event: {
          planTier: event.planTier,
          paidAt: event.paidAt,
          galleryExpiresAt: event.galleryExpiresAt,
          eventDate: event.eventDate,
        },
        payment: { plan: payment.plan },
        now,
      });
      if (patch) {
        // Clear pendingPlanTier — il a servi à pré-remplir le checkout, le
        // tier officiel `planTier` prend le relais une fois le paiement
        // confirmé. On laisse `pendingPlanTier` à `undefined` plutôt que de
        // supprimer le champ pour éviter les diffs inutiles si déjà absent.
        const fullPatch =
          event.pendingPlanTier !== undefined
            ? { ...patch, pendingPlanTier: undefined, updatedAt: now }
            : { ...patch, updatedAt: now };
        await ctx.db.patch(event._id, fullPatch);
      }
    }

    const owner = await ctx.db.get(payment.userId);

    // Parrainage / affiliation — exécuté à CHAQUE appel (y compris rejeu du
    // webhook), AVANT le court-circuit `alreadyApplied` : ces opérations sont
    // toutes idempotentes ET font partie du money-path. Si un premier passage a
    // marqué le paiement `succeeded` mais a échoué ici, le rejeu rattrape (le
    // crédit doit être consommé, sinon il reste dépensable). Best-effort strict —
    // ne DOIT jamais faire échouer la confirmation du paiement.
    //
    // Rattrapage d'attribution : pas de cookie `wdb_ref` (l'acheteur a tapé le
    // code au lieu de cliquer le lien) mais un code promo appliqué qui
    // correspond à un affilié actif → on rattache le paiement AVANT de créditer
    // le ledger. Sans ça, tout achat via code tapé perdait sa commission.
    let attributedAffiliateId = payment.affiliateId;
    if (!attributedAffiliateId && promotionCode) {
      try {
        const aff = await findActiveAffiliateByCode(ctx, promotionCode);
        if (aff) {
          attributedAffiliateId = aff._id;
          await ctx.db.patch(payment._id, { affiliateId: aff._id, updatedAt: now });
        }
      } catch {
        // best-effort — l'attribution ne bloque jamais la confirmation.
      }
    }

    if (attributedAffiliateId) {
      try {
        await applyReferral(ctx, {
          affiliateId: attributedAffiliateId,
          sourceSessionId: payment.providerSessionId,
          grossMinor: payment.amountMinor,
          // Commission assise sur l'encaissement réel, pas sur le catalogue.
          netMinor: netMinor !== undefined && netMinor >= 0 ? netMinor : payment.amountMinor,
          commissionBaseMinor,
          currency: payment.currency,
          purchasedAt: now,
          eventDate: event?.eventDate,
          eventId: payment.eventId,
          buyerUserId: payment.userId,
          buyerEmail: owner?.email ?? null,
        });
      } catch {
        // best-effort — la confirmation du paiement prime.
      }
    }
    try {
      await ensureReferralAffiliate(ctx, payment.userId);
    } catch {
      // best-effort
    }
    try {
      await consumeCreditReservation(ctx, payment.creditReservationId, payment.providerSessionId);
    } catch {
      // best-effort
    }

    if (alreadyApplied) {
      return { ok: true as const, alreadyApplied: true };
    }

    // Notification + reçu au propriétaire — première confirmation seulement.
    if (owner?.email) {
      const amountFormatted = formatAmount(payment.amountMinor, payment.currency);
      const eventTitle = event?.title ?? '';
      await ctx.scheduler.runAfter(0, internal.emailActions.sendProNotification, {
        to: owner.email,
        recipientName: owner.fullName ?? owner.phone ?? '',
        organizationName: eventTitle,
        kind: 'payment-received' as const,
        detailKey: 'paymentReceivedDetail',
        detailVars: { eventTitle },
        ctaLabelKey: 'paymentReceived',
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com'}/events/${payment.eventId}`,
        locale: owner.locale,
      });

      // Facture associée — envoyée juste après la confirmation. Le numéro de
      // facture est dérivé de `providerSessionId` (suffix court humain) ;
      // suffisant tant qu'on n'a pas une vraie séquence comptable. Si un PDF
      // est généré côté `lib/payments/invoice.ts`, on lui passera l'URL.
      const invoiceNumber = `INV-${providerSessionId.slice(-8).toUpperCase()}`;
      const ownerLocaleTag = ownerLocaleToIntlTag(owner.locale);
      const periodLabel = new Date(now).toLocaleDateString(ownerLocaleTag, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const invoiceUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com'}/events/${payment.eventId}/invoice?session=${providerSessionId}`;
      await ctx.scheduler.runAfter(0, internal.emailActions.sendStripeInvoice, {
        to: owner.email,
        recipientName: owner.fullName ?? owner.phone ?? '',
        organizationName: eventTitle,
        invoiceNumber,
        amountFormatted,
        periodLabel,
        invoiceUrl,
        locale: owner.locale,
      });
    }

    return { ok: true as const, alreadyApplied: false };
  },
});

function formatAmount(amountMinor: number, currency: string): string {
  const amount = amountMinor / 100;
  if (currency === 'EUR')
    return `${amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`;
  if (currency === 'USD') return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (currency === 'XOF') return `${amount.toLocaleString('fr-FR')} FCFA`;
  return `${amount.toLocaleString('fr-FR')} ${currency}`;
}

export const markFailed = mutation({
  args: {
    webhookSecret: v.string(),
    provider: PROVIDER,
    providerSessionId: v.string(),
    providerEventId: v.string(),
    status: v.union(v.literal('failed'), v.literal('cancelled')),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertWebhookSecret(args.webhookSecret);
    const payment = await ctx.db
      .query('payments')
      .withIndex('by_session', (q) =>
        q.eq('provider', args.provider).eq('providerSessionId', args.providerSessionId),
      )
      .first();
    if (!payment) throw new Error('PAYMENT_NOT_FOUND');

    if (payment.status === 'succeeded') {
      return { ok: true as const, alreadyApplied: true };
    }

    await ctx.db.patch(payment._id, {
      status: args.status,
      providerEventId: args.providerEventId,
      failureReason: args.failureReason,
      updatedAt: Date.now(),
    });

    // Checkout échoué/annulé → relâche le crédit de parrainage réservé (best-effort).
    try {
      await releaseCreditReservation(ctx, payment.creditReservationId);
    } catch {
      // best-effort — le GC cron rattrape sinon.
    }
    return { ok: true as const, alreadyApplied: false };
  },
});

export const listByEvent = query({
  args: { eventId: v.id('events'), requesterId: v.id('users') },
  handler: async (ctx, { eventId, requesterId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('EVENT_NOT_FOUND');
    if (event.ownerId !== requesterId) throw new Error('FORBIDDEN');

    return ctx.db
      .query('payments')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .order('desc')
      .collect();
  },
});

/**
 * Post-event upsell: pushes gallery retention to J+5y for a one-shot fee.
 *
 * **Fix sécurité F-09 (audit avril 2026)** : passé en `internalMutation` —
 * cette mutation ne doit être déclenchée que par le webhook après
 * confirmation d'un paiement upsell `succeeded` (kind: 'post-event-upsell').
 * La version publique précédente permettait à n'importe quel owner
 * d'événement d'étendre la rétention à 5 ans sans payer. Les call sites
 * légitimes passent par `ctx.scheduler.runAfter(0, internal.payments.extendRetentionPostEvent, ...)`.
 */
export const extendRetentionPostEvent = internalMutation({
  args: { eventId: v.id('events'), requesterId: v.id('users') },
  handler: async (ctx, { eventId, requesterId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error('EVENT_NOT_FOUND');
    if (event.ownerId !== requesterId) throw new Error('FORBIDDEN');

    const newExpiresAt = event.eventDate + POST_EVENT_UPSELL_RETENTION_DAYS * MS_PER_DAY;
    if (event.galleryExpiresAt && event.galleryExpiresAt >= newExpiresAt) {
      return { ok: true as const, alreadyExtended: true };
    }
    await ctx.db.patch(eventId, { galleryExpiresAt: newExpiresAt, updatedAt: Date.now() });
    return { ok: true as const, alreadyExtended: false };
  },
});

/**
 * Applique l'upsell HD post-event (+29 €) après confirmation Stripe.
 *
 * Déclenchée par le webhook (`checkout.session.completed`, metadata
 * `kind: 'post-event-upsell'`) **et** par le fallback de la page de succès si
 * le webhook est en retard. Idempotente : la clé `(provider, providerSessionId)`
 * garantit qu'un même paiement n'enregistre qu'une ligne et n'étend la galerie
 * qu'une fois.
 *
 * **Sécurité** : mutation publique (appelée depuis le serveur Next via le
 * webhook / la page de succès) mais gardée par `webhookSecret` — même schéma
 * que `organizations:updateSubscriptionFromWebhook` (fix F-01). Sans ce secret,
 * impossible de prolonger une galerie à 5 ans sans payer (cf. fix F-09 qui avait
 * passé `extendRetentionPostEvent` en internal).
 */
export const applyPostEventUpsell = mutation({
  args: {
    webhookSecret: v.string(),
    eventId: v.id('events'),
    requesterId: v.id('users'),
    provider: PROVIDER,
    providerSessionId: v.string(),
    amountMinor: v.number(),
    currency: CURRENCY,
    /** Token de réservation du crédit de parrainage (metadata de session). */
    creditReservationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Garde webhook canonique (helper partagé) — même barrière que les autres
    // bridges de ce fichier. Remplace l'ancien check inline `FORBIDDEN`.
    assertWebhookSecret(args.webhookSecret);

    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error('EVENT_NOT_FOUND');
    if (event.ownerId !== args.requesterId) throw new Error('FORBIDDEN');

    const now = Date.now();

    // Idempotence : si ce paiement a déjà été appliqué (renvoi de webhook ou
    // double passage webhook + fallback), on ne réinsère pas et on ne renotifie
    // pas — mais on s'assure quand même que la galerie est bien prolongée.
    const existing = await ctx.db
      .query('payments')
      .withIndex('by_session', (q) =>
        q.eq('provider', args.provider).eq('providerSessionId', args.providerSessionId),
      )
      .first();

    const newExpiresAt = event.eventDate + POST_EVENT_UPSELL_RETENTION_DAYS * MS_PER_DAY;
    const needsExtension = !event.galleryExpiresAt || event.galleryExpiresAt < newExpiresAt;
    if (needsExtension || event.hdUpsellPurchasedAt === undefined) {
      await ctx.db.patch(args.eventId, {
        ...(needsExtension ? { galleryExpiresAt: newExpiresAt } : {}),
        hdUpsellPurchasedAt: event.hdUpsellPurchasedAt ?? now,
        updatedAt: now,
      });
    }

    if (existing) {
      // Déjà enregistré → on s'assure simplement qu'il est marqué succeeded.
      if (existing.status !== 'succeeded') {
        await ctx.db.patch(existing._id, { status: 'succeeded', updatedAt: now });
      }
      return { ok: true as const, alreadyApplied: true };
    }

    await ctx.db.insert('payments', {
      userId: args.requesterId,
      eventId: args.eventId,
      kind: 'post_event_upsell',
      currency: args.currency,
      amountMinor: args.amountMinor,
      provider: args.provider,
      providerSessionId: args.providerSessionId,
      status: 'succeeded',
      createdAt: now,
      updatedAt: now,
    });

    // Parrainage : consomme le crédit réservé pour cet upsell (le parrain dépense
    // son crédit). Best-effort strict.
    try {
      await consumeCreditReservation(ctx, args.creditReservationId, args.providerSessionId);
    } catch {
      // best-effort — la confirmation prime.
    }

    // Notification + reçu au propriétaire (best-effort, première application
    // seulement). Mêmes canaux que `markSucceeded`.
    const owner = await ctx.db.get(args.requesterId);
    if (owner?.email) {
      const amountFormatted = formatAmount(args.amountMinor, args.currency);
      const eventTitle = event.title;
      await ctx.scheduler.runAfter(0, internal.emailActions.sendProNotification, {
        to: owner.email,
        recipientName: owner.fullName ?? owner.phone ?? '',
        organizationName: eventTitle,
        kind: 'payment-received' as const,
        detailKey: 'paymentReceivedDetail',
        detailVars: { eventTitle },
        ctaLabelKey: 'paymentReceived',
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com'}/events/${args.eventId}`,
        locale: owner.locale,
      });

      const invoiceNumber = `INV-${args.providerSessionId.slice(-8).toUpperCase()}`;
      const ownerLocaleTag = ownerLocaleToIntlTag(owner.locale);
      const periodLabel = new Date(now).toLocaleDateString(ownerLocaleTag, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const invoiceUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com'}/events/${args.eventId}/invoice?session=${args.providerSessionId}`;
      await ctx.scheduler.runAfter(0, internal.emailActions.sendStripeInvoice, {
        to: owner.email,
        recipientName: owner.fullName ?? owner.phone ?? '',
        organizationName: eventTitle,
        invoiceNumber,
        amountFormatted,
        periodLabel,
        invoiceUrl,
        locale: owner.locale,
      });
    }

    return { ok: true as const, alreadyApplied: false };
  },
});

/**
 * One-shot repair for events whose denormalised payment fields drifted
 * from their corresponding `payments` row (typically because an earlier
 * version of `markSucceeded` returned early on the idempotency guard
 * without ever patching the event).
 *
 * Scans every event with `planTier !== undefined` AND (`paidAt === undefined`
 * OR `galleryExpiresAt === undefined`), then for each finds the most recent
 * `succeeded` payment and applies the same reconciliation as `markSucceeded`.
 *
 * Internal-only — invoke via:
 *   pnpx convex run payments:_repairOrphanedEventGalleries
 */
export const _repairOrphanedEventGalleries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const skipped: Array<{ eventId: string; reason: string }> = [];
    let scanned = 0;
    let repaired = 0;

    const events = await ctx.db.query('events').collect();
    for (const event of events) {
      if (event.planTier === undefined) continue;
      if (event.paidAt !== undefined && event.galleryExpiresAt !== undefined) continue;

      scanned += 1;

      const payments = await ctx.db
        .query('payments')
        .withIndex('by_event', (q) => q.eq('eventId', event._id))
        .collect();
      const succeeded = payments
        // Seuls les paiements de forfait portent un `plan` à réconcilier ;
        // on ignore les upsells HD (`post_event_upsell`, sans `plan`).
        .filter((p) => p.status === 'succeeded' && p.plan !== undefined)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const payment = succeeded[0];

      if (!payment || !payment.plan) {
        skipped.push({ eventId: event._id, reason: 'NO_SUCCEEDED_PAYMENT' });
        continue;
      }

      const patch = computeEventReconciliation({
        event: {
          planTier: event.planTier,
          paidAt: event.paidAt,
          galleryExpiresAt: event.galleryExpiresAt,
          eventDate: event.eventDate,
        },
        payment: { plan: payment.plan },
        now,
      });

      if (!patch) {
        skipped.push({ eventId: event._id, reason: 'ALREADY_CONSISTENT' });
        continue;
      }

      await ctx.db.patch(event._id, { ...patch, updatedAt: now });
      repaired += 1;
    }

    return { scanned, repaired, skipped };
  },
});

/**
 * Paiements `pending` plus vieux que `olderThanMs` (T2-2, cron de
 * réconciliation Stripe↔Convex). Un couple qui ferme l'onglet avant
 * `/upgrade/success` avec un webhook manqué restait bloqué indéfiniment — ce
 * scan alimente `app/api/cron/reconcile-payments/route.ts`.
 *
 * PUBLIQUE mais gardée par `CONVEX_WEBHOOK_SECRET`, même patron que les
 * mutations de bridge webhook : le cron l'appelle via `ConvexHttpClient`, qui
 * ne peut pas invoquer d'`internalQuery`. Lecture seule (aucune écriture ici),
 * mais expose des lignes `payments` — le secret reste la seule barrière
 * contre un scraping direct de `*.convex.cloud`. `.take()` plafonne le coût
 * d'un run si beaucoup de paiements restent bloqués (ex. panne Stripe).
 */
export const listStalePending = query({
  args: { webhookSecret: v.string(), olderThanMs: v.number() },
  handler: async (ctx, { webhookSecret, olderThanMs }) => {
    assertWebhookSecret(webhookSecret);
    const cutoff = Date.now() - olderThanMs;
    return ctx.db
      .query('payments')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'pending').lt('createdAt', cutoff))
      .take(200);
  },
});

/**
 * Scan **lecture seule** des events avec un `planTier` actif mais AUCUN
 * paiement `succeeded` associé (T2-8, signe cité au premortem F3 : entitlement
 * sans paiement). Alimente une alerte hebdo (`app/api/cron/entitlement-audit/route.ts`).
 *
 * Volontairement DISTINCT de `_repairOrphanedEventGalleries` : ce dernier ne
 * scanne que les events dont `paidAt`/`galleryExpiresAt` sont incomplets (un
 * problème de dénormalisation) et s'arrête dès que ces deux champs sont
 * présents — un event dont ces champs auraient été renseignés SANS jamais
 * passer par un paiement réussi (le vrai signal de contournement F3) lui
 * échapperait. Ce scan-ci vérifie TOUT event `planTier` défini, sans
 * pré-filtre, et ne modifie jamais rien (contrairement au repair, qui est une
 * `internalMutation` one-shot déclenchée manuellement).
 *
 * PUBLIQUE mais gardée par `CONVEX_WEBHOOK_SECRET`, même patron que
 * `listStalePending` ci-dessus.
 */
export const scanOrphanedEntitlements = query({
  args: { webhookSecret: v.string() },
  handler: async (ctx, { webhookSecret }) => {
    assertWebhookSecret(webhookSecret);
    const events = await ctx.db.query('events').collect();
    const offenders: Array<{ eventId: string; planTier: 'essential' | 'premium' }> = [];
    let scanned = 0;

    for (const event of events) {
      if (event.planTier === undefined) continue;
      scanned += 1;

      const payments = await ctx.db
        .query('payments')
        .withIndex('by_event', (q) => q.eq('eventId', event._id))
        .collect();
      const hasSucceeded = payments.some((p) => p.status === 'succeeded');
      if (!hasSucceeded) {
        offenders.push({ eventId: event._id, planTier: event.planTier });
      }
    }

    return { scanned, offenders };
  },
});

/* ============================ PAIEMENTS AGENCE (Finances) ============================
 * Ledger des encaissements d'une agence, dérivé des **factures** du module
 * Devis & Factures (chaque entrée d'échéancier = une échéance encaissable).
 * Réservé Business+. `account.connected` reflète le compte Stripe de l'agence
 * connecté (BYOP) — l'agence encaisse sur son propre compte Stripe.
 */
export const overview = query({
  args: { organizationId: v.id('organizations'), requesterId: v.id('users') },
  handler: async (ctx, { organizationId, requesterId }) => {
    await assertOrgRead(ctx, organizationId, requesterId);
    const org = await ctx.db.get(organizationId);
    const allowed = proTierAtLeast(org?.subscriptionTier, 'business');

    const invoices = await ctx.db
      .query('quoteDocs')
      .withIndex('by_org_type', (q) => q.eq('organizationId', organizationId).eq('type', 'invoice'))
      .collect();

    return {
      allowed,
      invoices: invoices.map((d) => ({
        _id: d._id,
        number: d.number,
        clientName: d.clientName,
        eventId: d.eventId,
        status: d.status,
        schedule: d.schedule ?? [],
      })),
      account: {
        /** Mode d'encaissement (byop = via le Stripe de l'agence / manuel). Défaut : manuel. */
        mode: ((org?.paymentsMode ?? 'manual') === 'manual' ? 'manual' : 'byop') as
          | 'byop'
          | 'manual',
        /** Fréquence des versements (héritée ; en BYOP, gérée côté Stripe de l'agence). */
        payoutSchedule: (org?.payoutSchedule ?? 'daily') as 'daily' | 'weekly' | 'manual',
        /** Compte Stripe de l'agence connecté (capable d'encaisser en ligne) ? */
        connected: Boolean(org?.stripeConnectChargesEnabled),
        country: 'FR' as const,
      },
    };
  },
});
