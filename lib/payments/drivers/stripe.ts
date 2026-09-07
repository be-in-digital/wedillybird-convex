import Stripe from 'stripe';
import type {
  CheckoutInput,
  CheckoutSession,
  PaymentDriver,
  SessionStatus,
  VerifiedWebhookEvent,
} from '../provider';
import type { Currency } from '../plans';
import { isCurrency, priceIdForPlan, priceIdForPostEventUpsell } from '../plans';
import {
  priceIdForTier,
  tierForPriceId,
  type SubscriptionBilling,
  type SubscriptionStatus,
  type SubscriptionTier,
} from '../subscriptions';
import type { ConnectedBalance, ConnectedPayment, ConnectedPayout } from '../../pro/payments';

let cached: Stripe | null = null;

function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_DRIVER_NOT_CONFIGURED');
  cached = new Stripe(key);
  return cached;
}

const PLAN_LABEL: Record<string, string> = {
  essential: 'Wedillybird — Essentiel',
  premium: 'Wedillybird — Premium',
};

// Description affichée sur Stripe Checkout. Les forfaits particuliers sont
// désormais features-based (galerie 30j vs 6 mois + album PDF) — pas de quota
// invitations.
const PLAN_STRIPE_DESCRIPTION: Record<string, string> = {
  essential:
    'Invitations WhatsApp + RSVP temps réel + check-in offline + tableau de bord + galerie partagée 30 jours après le mariage.',
  premium:
    "Tout l'Essentiel + galerie partagée 6 mois après le mariage + album PDF final imprimable.",
};

// Stripe expects ISO 4217 currency codes lowercase. We store XOF in centimes
// internally (divisor 100), but Stripe represents XOF as zero-decimal. Ditto
// TND uses millimes (divisor 1000), which Stripe handles natively for TND.
// Conversion only matters for currencies Stripe supports.
const STRIPE_CURRENCY_DIVISOR_OVERRIDE: Partial<Record<Currency, number>> = {
  XOF: 100, // we store XOF as centimes internally; Stripe wants whole units
};

function toStripeAmount(minor: number, currency: Currency): number {
  const override = STRIPE_CURRENCY_DIVISOR_OVERRIDE[currency];
  return override ? Math.round(minor / override) : minor;
}

export const stripeDriver: PaymentDriver = {
  name: 'stripe',
  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const stripe = getStripe();

    // Préfère un Stripe Price stable (env var STRIPE_PRICE_<PLAN>_<CURRENCY>
    // ou alias EUR `STRIPE_PRICE_<PLAN>`) — créé par scripts/sync-stripe-prices.ts.
    // Si l'env var n'est pas configurée, tombe sur price_data inline pour ne
    // pas bloquer le checkout en dev. Couvre EUR + MAD + TND. XOF n'a pas de
    // processeur de paiement et n'arrive normalement jamais ici.
    const stablePrice = priceIdForPlan(input.plan, input.currency);
    const lineItem = stablePrice
      ? { quantity: 1, price: stablePrice }
      : {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: toStripeAmount(input.amountMinor, input.currency),
            product_data: {
              name: PLAN_LABEL[input.plan] ?? input.plan,
              description: PLAN_STRIPE_DESCRIPTION[input.plan],
              metadata: {
                plan: input.plan,
                wedillybird_plan_id: input.plan,
              },
            },
          },
        };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [lineItem],
      success_url: appendSessionIdParam(input.successUrl),
      cancel_url: input.cancelUrl,
      metadata: {
        eventId: input.eventId,
        userId: input.userId,
        plan: input.plan,
        ...(input.affiliateId ? { affiliateId: input.affiliateId } : {}),
        ...(input.creditReservationId ? { creditReservationId: input.creditReservationId } : {}),
      },
      client_reference_id: `${input.userId}:${input.eventId}`,
      locale: 'auto',
      // Crédit de parrainage appliqué → coupon dédié (Stripe interdit `discounts`
      // + `allow_promotion_codes` ensemble). Sinon, champ code promo ouvert.
      ...(input.discountCouponId
        ? { discounts: [{ coupon: input.discountCouponId }] }
        : { allow_promotion_codes: true }),
    });

    if (!session.url) throw new Error('STRIPE_NO_REDIRECT_URL');

    return {
      providerSessionId: session.id,
      redirectUrl: session.url,
    };
  },

  async verifyAndParseWebhook(
    rawBody: string,
    signature: string | null,
  ): Promise<VerifiedWebhookEvent> {
    if (!signature) throw new Error('INVALID_SIGNATURE');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_DRIVER_NOT_CONFIGURED');

    const stripe = getStripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new Error('INVALID_SIGNATURE');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        ...parseSession(session, event.id, 'succeeded'),
        promotionCode: (await resolveSessionPromotionCode(session)) ?? undefined,
      };
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session;
      return parseSession(session, event.id, 'failed');
    }
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      return parseSession(session, event.id, 'cancelled');
    }
    throw new Error('UNSUPPORTED_EVENT');
  },

  async retrieveSessionStatus(providerSessionId: string): Promise<SessionStatus> {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(providerSessionId);
    const currencyRaw = (session.currency ?? '').toUpperCase();
    if (!isCurrency(currencyRaw)) throw new Error('INVALID_CURRENCY');
    const stripeAmount = session.amount_total ?? 0;
    const override = STRIPE_CURRENCY_DIVISOR_OVERRIDE[currencyRaw];
    const amountMinor = override ? stripeAmount * override : stripeAmount;
    return {
      // Une session à 0 € (coupon 100 %) est marquée `no_payment_required`, pas
      // `paid` : sans ce cas, le webhook la finalisait mais la réconciliation de
      // secours (cron / page de succès) la voyait « impayée » et la signalait
      // bloquée à vie. On l'accepte uniquement si la session est `complete` —
      // strictement plus large que l'ancienne condition, jamais plus étroit.
      paid:
        session.payment_status === 'paid' ||
        (session.status === 'complete' && session.payment_status === 'no_payment_required'),
      providerSessionId: session.id,
      providerEventId: session.id,
      amountMinor,
      currency: currencyRaw,
      promotionCode: (await resolveSessionPromotionCode(session)) ?? undefined,
    };
  },
};

function appendSessionIdParam(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}session_id={CHECKOUT_SESSION_ID}`;
}

/* -------------------------------------------------------------------------- */
/*  Subscriptions (Pro plans: Starter / Business / Agency)                    */
/* -------------------------------------------------------------------------- */

export type SubscriptionCheckoutInput = {
  organizationId: string;
  requesterId: string;
  tier: SubscriptionTier;
  /** Mensuel par défaut. Annuel = -20 % sur le total. */
  billing?: SubscriptionBilling;
  /** Devise de la subscription. Défaut EUR. XOF non supporté côté Stripe. */
  currency?: Currency;
  customerEmail: string;
  /** Existing Stripe customer to attach the new subscription to (preferred). */
  stripeCustomerId?: string;
  successUrl: string;
  cancelUrl: string;
};

export async function createSubscriptionCheckout(
  input: SubscriptionCheckoutInput,
): Promise<CheckoutSession> {
  const stripe = getStripe();
  const billing = input.billing ?? 'monthly';
  const currency = input.currency ?? 'EUR';
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ quantity: 1, price: priceIdForTier(input.tier, billing, currency) }],
    success_url: appendSessionIdParam(input.successUrl),
    cancel_url: input.cancelUrl,
    customer: input.stripeCustomerId,
    customer_email: input.stripeCustomerId ? undefined : input.customerEmail,
    client_reference_id: input.organizationId,
    metadata: {
      organizationId: input.organizationId,
      requesterId: input.requesterId,
      tier: input.tier,
      billing,
    },
    subscription_data: {
      metadata: {
        organizationId: input.organizationId,
        tier: input.tier,
        billing,
      },
    },
    locale: 'auto',
    allow_promotion_codes: true,
  });
  if (!session.url) throw new Error('STRIPE_NO_REDIRECT_URL');
  return { providerSessionId: session.id, redirectUrl: session.url };
}

export async function openCustomerPortal(
  customerId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    locale: 'auto',
  });
  return { url: session.url };
}

export interface SubscriptionInvoice {
  /** Numéro de facture lisible (ou id si non émise). */
  id: string;
  /** Date d'émission (ms). */
  date: number;
  periodStart?: number;
  periodEnd?: number;
  amountMinor: number;
  currency: string;
  status: 'paid' | 'open' | 'void' | 'uncollectible' | 'draft';
  pdfUrl: string | null;
  hostedUrl: string | null;
}

/**
 * Liste les factures d'abonnement Stripe d'un client. Renvoie `[]` si Stripe
 * n'est pas configuré (dev) — l'UI affiche alors un état vide.
 */
export async function listSubscriptionInvoices(
  customerId: string,
  limit = 12,
): Promise<SubscriptionInvoice[]> {
  const stripe = getStripe();
  const res = await stripe.invoices.list({ customer: customerId, limit });
  return res.data.map((inv) => ({
    id: inv.number ?? inv.id ?? '—',
    date: (inv.created ?? 0) * 1000,
    periodStart: inv.period_start ? inv.period_start * 1000 : undefined,
    periodEnd: inv.period_end ? inv.period_end * 1000 : undefined,
    amountMinor: inv.amount_paid || inv.amount_due || inv.total || 0,
    currency: (inv.currency ?? 'eur').toUpperCase(),
    status: (inv.status ?? 'draft') as SubscriptionInvoice['status'],
    pdfUrl: inv.invoice_pdf ?? null,
    hostedUrl: inv.hosted_invoice_url ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/*  Pay-as-you-go pro (one-shot, 1 event)                                     */
/* -------------------------------------------------------------------------- */

export type PaygCheckoutInput = {
  organizationId: string;
  requesterId: string;
  /** Devise de l'achat. Défaut EUR. XOF non supporté côté Stripe. */
  currency?: Currency;
  customerEmail: string;
  stripeCustomerId?: string;
  successUrl: string;
  cancelUrl: string;
};

/**
 * Crée un Stripe Checkout one-shot pour un achat Pay-as-you-go pro (69 €,
 * crédite l'organisation de +1 event activable). Le `metadata.kind === 'payg'`
 * est lu par `verifyAndParseSubscriptionWebhook` pour router vers la mutation
 * Convex `paygPurchases:markPurchase`.
 */
export async function createPaygCheckout(input: PaygCheckoutInput): Promise<CheckoutSession> {
  const stripe = getStripe();
  const currency = input.currency ?? 'EUR';
  if (currency === 'XOF') throw new Error('UNSUPPORTED_STRIPE_CURRENCY');
  const envName = `STRIPE_PRICE_PAYG_EVENT_${currency}` as const;
  const priceId = process.env[envName] ?? process.env.STRIPE_PRICE_PAYG_EVENT;
  if (!priceId) throw new Error(`MISSING_${envName}`);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{ quantity: 1, price: priceId }],
    success_url: appendSessionIdParam(input.successUrl),
    cancel_url: input.cancelUrl,
    customer: input.stripeCustomerId,
    customer_email: input.stripeCustomerId ? undefined : input.customerEmail,
    client_reference_id: input.organizationId,
    metadata: {
      kind: 'payg',
      organizationId: input.organizationId,
      requesterId: input.requesterId,
    },
    locale: 'auto',
    allow_promotion_codes: true,
  });
  if (!session.url) throw new Error('STRIPE_NO_REDIRECT_URL');
  return { providerSessionId: session.id, redirectUrl: session.url };
}

/* -------------------------------------------------------------------------- */
/*  Upsell HD post-event (one-shot particulier, +29 €) — compte plateforme     */
/*                                                                            */
/*  Distinct des forfaits Essentiel/Premium : ne change pas le `planTier`, il  */
/*  prolonge la rétention galerie à 5 ans et débloque l'archive HD. Charge sur */
/*  le compte **plateforme** (pas Connect). La métadonnée                       */
/*  `kind: 'post-event-upsell'` route le webhook vers `applyPostEventUpsell`.   */
/* -------------------------------------------------------------------------- */

export type PostEventUpsellCheckoutInput = {
  eventId: string;
  /** Owner de l'event (= `requesterId` côté Convex). */
  userId: string;
  currency: Currency;
  amountMinor: number;
  successUrl: string;
  cancelUrl: string;
  /** Optional — coupon Stripe (crédit de parrainage appliqué). */
  discountCouponId?: string;
  /** Optional — token de réservation du crédit (metadata de session). */
  creditReservationId?: string;
};

const POST_EVENT_UPSELL_LABEL = 'Wedillybird — Archive HD (galerie 5 ans)';
const POST_EVENT_UPSELL_DESCRIPTION =
  'Prolonge votre galerie à 5 ans après le mariage et débloque le téléchargement HD de toutes vos photos.';

/**
 * Crée un Stripe Checkout one-shot pour l'upsell HD post-event. Préfère le
 * Stripe Price stable `STRIPE_PRICE_POST_EVENT_UPSELL[_<CURRENCY>]`, sinon
 * `price_data` inline (dev). `metadata.kind === 'post-event-upsell'` est lu par
 * `verifyAndParseSubscriptionWebhook`.
 */
export async function createPostEventUpsellCheckout(
  input: PostEventUpsellCheckoutInput,
): Promise<CheckoutSession> {
  const stripe = getStripe();
  if (input.currency === 'XOF' || input.currency === 'TND') {
    throw new Error('UNSUPPORTED_STRIPE_CURRENCY');
  }

  const stablePrice = priceIdForPostEventUpsell(input.currency);
  const lineItem = stablePrice
    ? { quantity: 1, price: stablePrice }
    : {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: toStripeAmount(input.amountMinor, input.currency),
          product_data: {
            name: POST_EVENT_UPSELL_LABEL,
            description: POST_EVENT_UPSELL_DESCRIPTION,
            metadata: { kind: 'post-event-upsell' },
          },
        },
      };

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [lineItem],
    success_url: appendSessionIdParam(input.successUrl),
    cancel_url: input.cancelUrl,
    metadata: {
      kind: 'post-event-upsell',
      eventId: input.eventId,
      requesterId: input.userId,
      ...(input.creditReservationId ? { creditReservationId: input.creditReservationId } : {}),
    },
    client_reference_id: `${input.userId}:${input.eventId}`,
    locale: 'auto',
    // Crédit de parrainage appliqué → coupon dédié (exclut le champ code promo).
    ...(input.discountCouponId
      ? { discounts: [{ coupon: input.discountCouponId }] }
      : { allow_promotion_codes: true }),
  });
  if (!session.url) throw new Error('STRIPE_NO_REDIRECT_URL');
  return { providerSessionId: session.id, redirectUrl: session.url };
}

export interface PostEventUpsellWebhookEvent {
  kind: 'post-event-upsell';
  eventId: string;
  requesterId: string;
  stripeSessionId: string;
  amountMinor: number;
  currency: Currency;
  /** Token de réservation du crédit de parrainage (metadata de session), si posé. */
  creditReservationId?: string;
}

/**
 * Classe une session Checkout (déjà vérifiée et **payée**) comme upsell HD,
 * ou null. Helper **pur** (pas d'appel réseau) → testable.
 */
export function classifyPostEventUpsellSession(
  session: Pick<Stripe.Checkout.Session, 'id' | 'metadata' | 'currency' | 'amount_total'>,
  eventType: string,
): PostEventUpsellWebhookEvent | null {
  if (eventType !== 'checkout.session.completed') return null;
  if (session.metadata?.kind !== 'post-event-upsell') return null;
  const eventId = session.metadata.eventId;
  const requesterId = session.metadata.requesterId;
  if (!eventId || !requesterId) return null;
  const currencyRaw = (session.currency ?? '').toUpperCase();
  if (!isCurrency(currencyRaw)) return null;
  const stripeAmount = session.amount_total ?? 0;
  const override = STRIPE_CURRENCY_DIVISOR_OVERRIDE[currencyRaw];
  const creditReservationId = session.metadata.creditReservationId;
  return {
    kind: 'post-event-upsell',
    eventId,
    requesterId,
    stripeSessionId: session.id,
    amountMinor: override ? stripeAmount * override : stripeAmount,
    currency: currencyRaw,
    ...(creditReservationId ? { creditReservationId } : {}),
  };
}

/**
 * Récupère le statut d'une session Checkout d'upsell HD (compte plateforme),
 * pour le fallback de la page de succès si le webhook est en retard. Renvoie
 * null si la session n'est pas un upsell payé.
 */
export async function retrievePostEventUpsellSessionStatus(
  sessionId: string,
): Promise<PostEventUpsellWebhookEvent | null> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') return null;
  return classifyPostEventUpsellSession(session, 'checkout.session.completed');
}

export type SubscriptionWebhookEvent =
  | {
      kind: 'subscription.upserted';
      organizationId: string;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      tier: SubscriptionTier;
      billing: SubscriptionBilling;
      status: SubscriptionStatus;
      currentPeriodEnd: number;
    }
  | {
      kind: 'subscription.deleted';
      organizationId: string | null;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
    }
  | {
      kind: 'invoice.paid';
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      amountMinor: number;
      currency: Currency;
    }
  | {
      kind: 'invoice.payment_failed';
      stripeCustomerId: string;
      stripeSubscriptionId: string;
    }
  | {
      kind: 'payg.purchased';
      organizationId: string;
      requesterId: string;
      stripeSessionId: string;
      amountMinor: number;
      currency: Currency;
    }
  | PostEventUpsellWebhookEvent;

/**
 * Verify a webhook signature and parse it as a subscription-related event.
 * Returns null when the event is unrelated to subscriptions (caller should
 * fall back to the one-shot payment driver's `verifyAndParseWebhook`).
 */
export async function verifyAndParseSubscriptionWebhook(
  rawBody: string,
  signature: string | null,
): Promise<SubscriptionWebhookEvent | null> {
  // Vérif double-secret : un event Connect (compte connecté) est signé avec le
  // secret Connect, pas le secret plateforme. On le vérifie quand même ici pour
  // qu'il « tombe » en null (pas un abonnement) et que le caller continue vers les
  // parseurs budget / liens — sinon il serait rejeté en 400 AVANT de les atteindre
  // (les liens de paiement ne se réconcilieraient jamais en prod).
  const event = verifyStripeSignatureWithConnect(rawBody, signature);

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated'
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const item = sub.items.data[0];
    if (!item) return null;
    const tierMatch = tierForPriceId(item.price.id);
    if (!tierMatch) return null;
    const orgId = (sub.metadata?.organizationId as string | undefined) ?? null;
    if (!orgId) return null;
    return {
      kind: 'subscription.upserted',
      organizationId: orgId,
      stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      stripeSubscriptionId: sub.id,
      tier: tierMatch.tier,
      billing: tierMatch.billing,
      status: sub.status as SubscriptionStatus,
      currentPeriodEnd: item.current_period_end * 1000,
    };
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    return {
      kind: 'subscription.deleted',
      organizationId: (sub.metadata?.organizationId as string | undefined) ?? null,
      stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      stripeSubscriptionId: sub.id,
    };
  }

  if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    const subId =
      'subscription' in invoice && typeof invoice.subscription === 'string'
        ? invoice.subscription
        : null;
    if (!subId) return null;
    const currencyRaw = (invoice.currency ?? '').toUpperCase();
    if (!isCurrency(currencyRaw)) return null;
    const stripeAmount = invoice.amount_paid ?? 0;
    const override = STRIPE_CURRENCY_DIVISOR_OVERRIDE[currencyRaw];
    return {
      kind: 'invoice.paid',
      stripeCustomerId:
        typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? ''),
      stripeSubscriptionId: subId,
      amountMinor: override ? stripeAmount * override : stripeAmount,
      currency: currencyRaw,
    };
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const subId =
      'subscription' in invoice && typeof invoice.subscription === 'string'
        ? invoice.subscription
        : null;
    if (!subId) return null;
    return {
      kind: 'invoice.payment_failed',
      stripeCustomerId:
        typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? ''),
      stripeSubscriptionId: subId,
    };
  }

  // Upsell HD post-event (particulier, one-shot plateforme) : checkout en mode
  // `payment` avec `metadata.kind === 'post-event-upsell'`. Intercepté ici pour
  // qu'il n'atteigne PAS le driver one-shot standard (`markSucceeded`), qui
  // exige une ligne `payments` pré-enregistrée (recordIntent) absente ici.
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const upsell = classifyPostEventUpsellSession(session, event.type);
    if (upsell) return upsell;
  }

  // Pay-as-you-go pro : checkout one-shot en mode `payment` avec
  // `metadata.kind === 'payg'`. Distinct des paiements particuliers
  // (essential/premium) qui passent par le driver one-shot standard.
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind !== 'payg') return null;
    const organizationId = session.metadata.organizationId;
    const requesterId = session.metadata.requesterId;
    if (!organizationId || !requesterId) return null;
    const currencyRaw = (session.currency ?? '').toUpperCase();
    if (!isCurrency(currencyRaw)) return null;
    const stripeAmount = session.amount_total ?? 0;
    const override = STRIPE_CURRENCY_DIVISOR_OVERRIDE[currencyRaw];
    return {
      kind: 'payg.purchased',
      organizationId,
      requesterId,
      stripeSessionId: session.id,
      amountMinor: override ? stripeAmount * override : stripeAmount,
      currency: currencyRaw,
    };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*  Budget — paiement en ligne d'un montant arbitraire (Wedillybird Pay)      */
/* -------------------------------------------------------------------------- */

export type BudgetCheckoutInput = {
  amountMinor: number;
  /** Libellé affiché sur la page Stripe (ex. « Acompte — Domaine de Bellevue »). */
  description: string;
  /** Id du `budgetPayments` en attente, transmis en métadonnée pour la réconciliation. */
  budgetPaymentId: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Compte Stripe **de l'agence** (connecté via OAuth Standard). L'encaissement
   * est une *direct charge* : la session Checkout est créée sur le compte de
   * l'agence (en-tête `Stripe-Account`), les fonds y vont directement, l'agence
   * est marchand de référence (porte ses frais et litiges), et la plateforme
   * n'est jamais dans le flux. Requis : sans compte connecté, le caller ne crée
   * pas de lien.
   */
  stripeAccountId: string;
};

/**
 * Crée une session Checkout Stripe pour un montant EUR arbitraire (paiement d'une
 * ligne de budget par le couple). À usage unique ; le lien expire selon Stripe
 * (~24h). La métadonnée `kind: 'budget_payment'` permet au webhook de router vers
 * le bon paiement sans le confondre avec un forfait particulier.
 */
export async function createBudgetCheckout(input: BudgetCheckoutInput): Promise<CheckoutSession> {
  return createConnectedCheckout({
    amountMinor: input.amountMinor,
    description: input.description,
    metadata: { kind: 'budget_payment', budgetPaymentId: input.budgetPaymentId },
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    stripeAccountId: input.stripeAccountId,
  });
}

/**
 * Crée une session Checkout *direct charge* sur le compte connecté de l'agence
 * (en-tête `Stripe-Account`) : la session vit sur le compte de l'agence, qui
 * encaisse directement et porte ses propres frais et litiges. Aucun transfert
 * plateforme — Wedillybird n'est jamais dans le flux. Base
 * commune aux paiements budget et aux liens de paiement (facture / libre).
 */
async function createConnectedCheckout(input: {
  amountMinor: number;
  description: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  stripeAccountId: string;
}): Promise<CheckoutSession> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      // On NE fixe PAS `payment_method_types` : Checkout affiche alors
      // dynamiquement tous les moyens que l'agence a activés sur SON propre
      // dashboard Stripe et qui sont éligibles au montant/à la devise (carte,
      // virement SEPA, etc.). L'agence gère ses moyens depuis son Stripe (BYOP).
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: input.amountMinor,
            product_data: { name: input.description },
          },
        },
      ],
      success_url: appendSessionIdParam(input.successUrl),
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
      locale: 'auto',
    },
    { stripeAccount: input.stripeAccountId },
  );
  if (!session.url) throw new Error('STRIPE_NO_REDIRECT_URL');
  return { providerSessionId: session.id, redirectUrl: session.url };
}

export type PaymentLinkCheckoutInput = {
  amountMinor: number;
  /** Libellé affiché au couple sur Stripe (ex. « FAC-2026-031 · Acompte »). */
  description: string;
  /** Id du `paymentLinks` en attente, transmis en métadonnée pour la réconciliation. */
  paymentLinkId: string;
  successUrl: string;
  cancelUrl: string;
  /** Compte Stripe **de l'agence** (connecté via OAuth). Requis (charge directe). */
  stripeAccountId: string;
};

/**
 * Crée un lien de paiement Stripe (générique : facture ou libre) sur le compte
 * connecté de l'agence. La métadonnée `kind: 'payment_link'` route le webhook.
 */
export async function createPaymentLinkCheckout(
  input: PaymentLinkCheckoutInput,
): Promise<CheckoutSession> {
  return createConnectedCheckout({
    amountMinor: input.amountMinor,
    description: input.description,
    metadata: { kind: 'payment_link', paymentLinkId: input.paymentLinkId },
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    stripeAccountId: input.stripeAccountId,
  });
}

export interface BudgetPaymentWebhookEvent {
  kind: 'budget_payment';
  budgetPaymentId: string;
  providerSessionId: string;
  providerEventId: string;
  status: 'succeeded' | 'failed';
  /** Compte connecté d'origine de l'event (`event.account`) — anti-falsification inter-tenant. */
  stripeAccountId?: string | null;
  receiptUrl?: string;
}

/**
 * Classe une session Checkout (déjà vérifiée) comme paiement de budget, ou null
 * si ce n'en est pas un. Helper **pur** (pas d'appel réseau) → testable.
 */
export function classifyBudgetSession(
  session: Pick<Stripe.Checkout.Session, 'id' | 'metadata'>,
  eventType: string,
  eventId: string,
): Omit<BudgetPaymentWebhookEvent, 'receiptUrl'> | null {
  if (
    eventType !== 'checkout.session.completed' &&
    eventType !== 'checkout.session.expired' &&
    eventType !== 'checkout.session.async_payment_failed'
  ) {
    return null;
  }
  if (session.metadata?.kind !== 'budget_payment') return null;
  const budgetPaymentId = session.metadata.budgetPaymentId;
  if (!budgetPaymentId) return null;
  return {
    kind: 'budget_payment',
    budgetPaymentId,
    providerSessionId: session.id,
    providerEventId: eventId,
    status: eventType === 'checkout.session.completed' ? 'succeeded' : 'failed',
  };
}

/**
 * Vérifie la signature et parse un webhook comme paiement de budget. Renvoie
 * null si l'event n'est pas un paiement de budget (le caller continue vers les
 * autres parseurs). Sur succès, récupère le reçu Stripe (preuve auto).
 */
/**
 * Vérifie la signature d'un webhook Stripe en essayant le secret plateforme puis,
 * en repli, le secret Connect (`STRIPE_CONNECT_WEBHOOK_SECRET`) pour les événements
 * des comptes connectés (charges directes BYOP). Additif : sans secret Connect, le
 * comportement est identique à une vérif simple par le secret plateforme — les
 * webhooks d'abonnement (compte plateforme) ne sont donc pas affectés.
 */
function verifyStripeSignatureWithConnect(rawBody: string, signature: string | null): Stripe.Event {
  if (!signature) throw new Error('INVALID_SIGNATURE');
  const primary = process.env.STRIPE_WEBHOOK_SECRET;
  if (!primary) throw new Error('STRIPE_DRIVER_NOT_CONFIGURED');
  const stripe = getStripe();
  const secrets = [primary, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((s): s is string =>
    Boolean(s),
  );
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      // signature invalide pour ce secret → on tente le suivant (Connect)
    }
  }
  throw new Error('INVALID_SIGNATURE');
}

export async function parseBudgetPaymentWebhook(
  rawBody: string,
  signature: string | null,
): Promise<BudgetPaymentWebhookEvent | null> {
  const event = verifyStripeSignatureWithConnect(rawBody, signature);

  const base = classifyBudgetSession(
    event.data.object as Stripe.Checkout.Session,
    event.type,
    event.id,
  );
  if (!base) return null;
  const withAccount = { ...base, stripeAccountId: event.account ?? null };
  if (withAccount.status !== 'succeeded') return withAccount;

  // En direct charge, le webhook est un event Connect (`event.account` renseigné).
  // On récupère le reçu via l'en-tête `Stripe-Account` du bon compte.
  const receiptUrl = await retrieveCheckoutReceiptUrl(
    withAccount.providerSessionId,
    event.account ?? undefined,
  );
  return { ...withAccount, ...(receiptUrl ? { receiptUrl } : {}) };
}

/**
 * Récupère l'URL du reçu hébergé Stripe d'une session Checkout (best-effort).
 * En charge directe, le reçu vit sur le compte connecté → en-tête `Stripe-Account`.
 */
async function retrieveCheckoutReceiptUrl(
  sessionId: string,
  connectedAccount: string | undefined,
): Promise<string | undefined> {
  const stripe = getStripe();
  try {
    const full = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ['payment_intent.latest_charge'] },
      connectedAccount ? { stripeAccount: connectedAccount } : undefined,
    );
    const pi = full.payment_intent;
    if (pi && typeof pi !== 'string') {
      const charge = pi.latest_charge;
      if (charge && typeof charge !== 'string' && charge.receipt_url) return charge.receipt_url;
    }
  } catch {
    // pas de reçu → on encaisse quand même.
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/*  Liens de paiement génériques (facture / libre) — compte connecté agence    */
/* -------------------------------------------------------------------------- */

export interface PaymentLinkWebhookEvent {
  kind: 'payment_link';
  paymentLinkId: string;
  providerSessionId: string;
  providerEventId: string;
  status: 'succeeded' | 'failed';
  /** Compte connecté d'origine de l'event (`event.account`) — anti-falsification inter-tenant. */
  stripeAccountId?: string | null;
  receiptUrl?: string;
}

/**
 * Classe une session Checkout comme paiement d'un lien générique, ou null. Helper
 * **pur** (pas d'appel réseau) → testable.
 */
export function classifyPaymentLinkSession(
  session: Pick<Stripe.Checkout.Session, 'id' | 'metadata'>,
  eventType: string,
  eventId: string,
): Omit<PaymentLinkWebhookEvent, 'receiptUrl'> | null {
  if (
    eventType !== 'checkout.session.completed' &&
    eventType !== 'checkout.session.expired' &&
    eventType !== 'checkout.session.async_payment_failed'
  ) {
    return null;
  }
  if (session.metadata?.kind !== 'payment_link') return null;
  const paymentLinkId = session.metadata.paymentLinkId;
  if (!paymentLinkId) return null;
  return {
    kind: 'payment_link',
    paymentLinkId,
    providerSessionId: session.id,
    providerEventId: eventId,
    status: eventType === 'checkout.session.completed' ? 'succeeded' : 'failed',
  };
}

/**
 * Vérifie la signature et parse un webhook comme paiement d'un lien générique.
 * Renvoie null si ce n'en est pas un. Sur succès, récupère le reçu (preuve auto).
 */
export async function parsePaymentLinkWebhook(
  rawBody: string,
  signature: string | null,
): Promise<PaymentLinkWebhookEvent | null> {
  const event = verifyStripeSignatureWithConnect(rawBody, signature);
  const base = classifyPaymentLinkSession(
    event.data.object as Stripe.Checkout.Session,
    event.type,
    event.id,
  );
  if (!base) return null;
  const withAccount = { ...base, stripeAccountId: event.account ?? null };
  if (withAccount.status !== 'succeeded') return withAccount;
  const receiptUrl = await retrieveCheckoutReceiptUrl(
    withAccount.providerSessionId,
    event.account ?? undefined,
  );
  return { ...withAccount, ...(receiptUrl ? { receiptUrl } : {}) };
}

/* -------------------------------------------------------------------------- */
/*  Stripe Connect — onboarding hébergé (comptes Standard + account_links)      */
/*  L'agence configure/connecte son propre compte Stripe via une page hébergée  */
/*  par Stripe, puis les encaissements sont des charges directes (en-tête       */
/*  `Stripe-Account`). Remplace l'ancien OAuth (déprécié pour les Standard).     */
/* -------------------------------------------------------------------------- */

export interface ConnectAccountStatus {
  /** Le compte peut encaisser (onboarding terminé) → débloque la création de liens. */
  chargesEnabled: boolean;
  /** L'agence a soumis ses informations d'onboarding. */
  detailsSubmitted: boolean;
  /** Les virements vers la banque de l'agence sont activés. */
  payoutsEnabled: boolean;
}

/** Mappe un compte Stripe → statut Connect. Helper **pur** (testable). */
export function mapConnectAccountStatus(
  account: Pick<Stripe.Account, 'charges_enabled' | 'details_submitted' | 'payouts_enabled'>,
): ConnectAccountStatus {
  return {
    chargesEnabled: Boolean(account.charges_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    payoutsEnabled: Boolean(account.payouts_enabled),
  };
}

/**
 * Crée un **compte connecté Standard** pour l'agence. L'agence garde le contrôle
 * total (son propre dashboard Stripe, ses frais, ses litiges) ; la plateforme fait
 * des charges directes via l'en-tête `Stripe-Account` et ne touche jamais les fonds.
 * Lève si Connect n'est pas activé côté plateforme.
 */
export async function createConnectedAccount(input?: {
  email?: string;
  businessName?: string;
}): Promise<{ accountId: string }> {
  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: 'standard',
    ...(input?.email ? { email: input.email } : {}),
    ...(input?.businessName ? { business_profile: { name: input.businessName } } : {}),
  });
  return { accountId: account.id };
}

/**
 * Crée un lien d'onboarding hébergé par Stripe pour un compte connecté. L'agence
 * y configure (ou s'y connecte avec) son compte Stripe. `refreshUrl` est rappelé
 * si le lien expire ; `returnUrl` au retour (on rafraîchit alors le statut).
 */
export async function createAccountOnboardingLink(input: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  const link = await stripe.accountLinks.create({
    account: input.accountId,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: 'account_onboarding',
  });
  return { url: link.url };
}

/** Récupère le statut d'un compte connecté (charges / details / payouts enabled). */
export async function retrieveConnectedAccountStatus(
  accountId: string,
): Promise<ConnectAccountStatus> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(accountId);
  return mapConnectAccountStatus(account);
}

/* -------------------------------------------------------------------------- */
/*  One-shot payment helpers (existing)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Code promo lisible (« SARAH ») appliqué à une session, ou `null`.
 *
 * Dans un payload de webhook, `session.discounts[].promotion_code` est un ID
 * (`promo_…`), pas le code affiché — il faut un aller-retour API pour le
 * résoudre. Best-effort strict : une erreur Stripe ne doit jamais faire échouer
 * la confirmation d'un paiement (au pire l'attribution est perdue, ce qui est
 * exactement l'état d'avant).
 */
async function resolveSessionPromotionCode(
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  const applied = session.discounts?.[0]?.promotion_code;
  if (!applied) return null;
  if (typeof applied !== 'string') return applied.code ?? null;
  try {
    const promo = await getStripe().promotionCodes.retrieve(applied);
    return promo.code ?? null;
  } catch {
    return null;
  }
}

function parseSession(
  session: Stripe.Checkout.Session,
  eventId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
): VerifiedWebhookEvent {
  const currencyRaw = (session.currency ?? '').toUpperCase();
  if (!isCurrency(currencyRaw)) throw new Error('INVALID_CURRENCY');

  const stripeAmount = session.amount_total ?? 0;
  const override = STRIPE_CURRENCY_DIVISOR_OVERRIDE[currencyRaw];
  const amountMinor = override ? stripeAmount * override : stripeAmount;

  return {
    providerSessionId: session.id,
    providerEventId: eventId,
    status,
    amountMinor,
    currency: currencyRaw,
    failureReason:
      typeof session.payment_status === 'string' && status !== 'succeeded'
        ? session.payment_status
        : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/*  Lecture du compte Stripe connecté (solde / virements / encaissements)      */
/*  L'agence voit son argent SANS quitter la plateforme. En-tête Stripe-Account.*/
/* -------------------------------------------------------------------------- */

/** Mappe le solde Stripe → EUR (centimes), dispo + en attente. Pur (testable). */
export function mapConnectedBalance(balance: Stripe.Balance): ConnectedBalance {
  const sumEur = (rows: ReadonlyArray<{ amount: number; currency: string }>) =>
    rows.filter((r) => r.currency === 'eur').reduce((a, r) => a + r.amount, 0);
  return {
    availableMinor: sumEur(balance.available ?? []),
    pendingMinor: sumEur(balance.pending ?? []),
    currency: 'EUR',
  };
}

/** Mappe un virement Stripe → forme client-safe. Pur. */
export function mapConnectedPayout(p: Stripe.Payout): ConnectedPayout {
  return {
    id: p.id,
    amountMinor: p.amount,
    currency: (p.currency ?? 'eur').toUpperCase(),
    status: p.status,
    arrivalDate: (p.arrival_date ?? 0) * 1000,
    created: (p.created ?? 0) * 1000,
  };
}

/** Mappe une charge Stripe → forme client-safe. Pur. */
export function mapConnectedPayment(c: Stripe.Charge): ConnectedPayment {
  return {
    id: c.id,
    amountMinor: c.amount,
    currency: (c.currency ?? 'eur').toUpperCase(),
    status: c.status,
    created: (c.created ?? 0) * 1000,
    description: c.description ?? null,
    customerEmail: c.billing_details?.email ?? null,
    receiptUrl: c.receipt_url ?? null,
    // `refunded` n'est vrai qu'au remboursement TOTAL ; on traite aussi le partiel
    // comme remboursé pour l'affichage (sinon la charge réapparaît « remboursable »).
    refunded: Boolean(c.refunded) || (c.amount_refunded ?? 0) > 0,
  };
}

/** Solde du compte connecté de l'agence (en-tête `Stripe-Account`). */
export async function retrieveConnectedBalance(accountId: string): Promise<ConnectedBalance> {
  const stripe = getStripe();
  const balance = await stripe.balance.retrieve({}, { stripeAccount: accountId });
  return mapConnectedBalance(balance);
}

/** Derniers virements du compte connecté vers la banque de l'agence. */
export async function listConnectedPayouts(
  accountId: string,
  limit = 5,
): Promise<ConnectedPayout[]> {
  const stripe = getStripe();
  const res = await stripe.payouts.list({ limit }, { stripeAccount: accountId });
  return res.data.map(mapConnectedPayout);
}

/** Derniers encaissements (charges) reçus sur le compte connecté. */
export async function listConnectedPayments(
  accountId: string,
  limit = 8,
): Promise<ConnectedPayment[]> {
  const stripe = getStripe();
  const res = await stripe.charges.list({ limit }, { stripeAccount: accountId });
  return res.data.map(mapConnectedPayment);
}

/**
 * Rembourse intégralement une charge sur le compte connecté de l'agence
 * (en-tête `Stripe-Account`). Les fonds repartent du compte de l'agence — la
 * plateforme n'est jamais dans le flux.
 */
export async function refundConnectedCharge(
  accountId: string,
  chargeId: string,
): Promise<{ id: string; status: string }> {
  const stripe = getStripe();
  // Vérifie que la charge existe bien sur CE compte connecté, est réussie et pas
  // déjà remboursée — évite de rembourser une charge arbitraire ou un double
  // remboursement. (Le scoping `stripeAccount` empêche déjà tout cross-compte.)
  let charge: Stripe.Charge;
  try {
    charge = await stripe.charges.retrieve(chargeId, undefined, { stripeAccount: accountId });
  } catch {
    throw new Error('CHARGE_NOT_FOUND');
  }
  if (charge.status !== 'succeeded') throw new Error('CHARGE_NOT_REFUNDABLE');
  if (charge.refunded || (charge.amount_refunded ?? 0) > 0) throw new Error('ALREADY_REFUNDED');
  const refund = await stripe.refunds.create(
    { charge: chargeId },
    { stripeAccount: accountId, idempotencyKey: `refund_${chargeId}` },
  );
  return { id: refund.id, status: refund.status ?? 'unknown' };
}

/* -------------------------------------------------------------------------- */
/*  Admin plateforme — remboursements one-shot + gestion des abonnements       */
/*                                                                            */
/*  Ces opérations s'exécutent sur le compte Stripe **de la plateforme**       */
/*  (pas d'en-tête `stripeAccount`), contrairement aux fonctions BYOP Connect  */
/*  ci-dessus qui ciblent le compte connecté de l'agence.                      */
/* -------------------------------------------------------------------------- */

/**
 * Rembourse un paiement one-shot plateforme (Essentiel / Premium) à partir de
 * l'id de session Checkout stocké dans `payments.providerSessionId`.
 *
 * - `amountMinor` omis → remboursement **total** ; sinon remboursement partiel
 *   du montant indiqué (unités mineures, même devise que la charge).
 * - Idempotence : clé dérivée de la session + du montant pour éviter les doublons
 *   si l'action est rejouée.
 *
 * Throws : `SESSION_NOT_FOUND`, `NOT_PAID`, `NO_PAYMENT_INTENT`,
 * `ALREADY_FULLY_REFUNDED`.
 */
export async function refundPlatformPayment(
  providerSessionId: string,
  amountMinor?: number,
): Promise<{ id: string; status: string; amountMinor: number }> {
  const stripe = getStripe();

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(providerSessionId);
  } catch {
    throw new Error('SESSION_NOT_FOUND');
  }
  if (session.payment_status !== 'paid') throw new Error('NOT_PAID');

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  if (!paymentIntentId) throw new Error('NO_PAYMENT_INTENT');

  const refund = await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      ...(amountMinor != null ? { amount: amountMinor } : {}),
    },
    { idempotencyKey: `admin_refund_${providerSessionId}_${amountMinor ?? 'full'}` },
  );

  return {
    id: refund.id,
    status: refund.status ?? 'unknown',
    amountMinor: refund.amount,
  };
}

/**
 * Annule un abonnement pro plateforme.
 * - `mode: 'period_end'` → `cancel_at_period_end = true` : l'agence garde
 *   l'accès jusqu'à la fin de la période déjà payée.
 * - `mode: 'immediate'` → `subscriptions.cancel` : coupe l'accès tout de suite
 *   (pas de remboursement prorata automatique — à faire séparément si voulu).
 */
export async function cancelPlatformSubscription(
  subscriptionId: string,
  mode: 'period_end' | 'immediate',
): Promise<{ status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: number | null }> {
  const stripe = getStripe();
  let sub: Stripe.Subscription;
  if (mode === 'immediate') {
    sub = await stripe.subscriptions.cancel(subscriptionId);
  } else {
    sub = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
  return {
    status: sub.status,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    currentPeriodEnd: periodEnd ? periodEnd * 1000 : null,
  };
}

/**
 * Réactive un abonnement programmé pour annulation en fin de période
 * (`cancel_at_period_end = false`). Sans effet si l'abonnement est déjà
 * totalement annulé côté Stripe (lever alors une nouvelle souscription).
 */
export async function reactivatePlatformSubscription(
  subscriptionId: string,
): Promise<{ status: string; cancelAtPeriodEnd: boolean }> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
  return { status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end ?? false };
}

/* -------------------------------------------------------------------------- */
/*  Admin plateforme — coupons, codes promo & remises (gestes commerciaux)     */
/*                                                                            */
/*  Modèle Stripe : un **Coupon** définit la réduction (% ou montant fixe +    */
/*  durée), un **Promotion Code** est le code lisible saisi au checkout qui    */
/*  pointe vers un coupon. Tout sur le compte plateforme.                      */
/* -------------------------------------------------------------------------- */

export interface AdminCoupon {
  id: string;
  name: string | null;
  percentOff: number | null;
  amountOffMinor: number | null;
  currency: string | null;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths: number | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  redeemBy: number | null;
  valid: boolean;
  createdAt: number;
  /** Produits Stripe auxquels le coupon est restreint (`applies_to.products`). Vide = tous. */
  appliesToProducts: string[];
}

export interface AdminPromotionCode {
  id: string;
  code: string;
  couponId: string;
  couponLabel: string;
  active: boolean;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: number | null;
  createdAt: number;
}

function mapCoupon(c: Stripe.Coupon): AdminCoupon {
  // L'API Stripe « 2026-04-22.dahlia » ne renvoie plus `applies_to` sur l'objet
  // coupon (la restriction produit reste bien ENFORCÉE côté Stripe à la
  // redemption — vérifié — mais n'est plus lisible en lecture). On retombe donc
  // sur la metadata `wedillybird_applies_to` posée à la création (cf.
  // createCoupon) pour continuer d'afficher la restriction « forfaits pros ».
  const appliesToProducts =
    c.applies_to?.products ??
    (c.metadata?.wedillybird_applies_to
      ? c.metadata.wedillybird_applies_to.split(',').filter(Boolean)
      : []);
  return {
    id: c.id,
    name: c.name ?? null,
    percentOff: c.percent_off ?? null,
    amountOffMinor: c.amount_off ?? null,
    currency: c.currency ? c.currency.toUpperCase() : null,
    duration: c.duration,
    durationInMonths: c.duration_in_months ?? null,
    maxRedemptions: c.max_redemptions ?? null,
    timesRedeemed: c.times_redeemed ?? 0,
    redeemBy: c.redeem_by ? c.redeem_by * 1000 : null,
    valid: c.valid,
    createdAt: (c.created ?? 0) * 1000,
    appliesToProducts,
  };
}

/**
 * Coupon Stripe montant-fixe à usage unique — crédit de parrainage et/ou remise
 * affiliée appliqués à un checkout précis. `amount_off` dans la devise,
 * `duration: once`, 1 seule redemption, expiration courte (24 h). Retourne l'id
 * du coupon.
 *
 * Un SEUL coupon par session : Stripe n'accepte qu'une entrée dans `discounts`,
 * donc crédit et remise sont fusionnés en amont (`splitOrderDiscounts`). `kind`
 * n'existe que pour la lisibilité côté Dashboard Stripe et la réconciliation
 * comptable — il ne change aucun montant.
 */
export async function createOneTimeAmountCoupon(
  amountOffMinor: number,
  currency: Currency,
  kind:
    | 'referral_credit'
    | 'affiliate_discount'
    | 'referral_credit_and_discount' = 'referral_credit',
): Promise<string> {
  const stripe = getStripe();
  const coupon = await stripe.coupons.create({
    amount_off: toStripeAmount(amountOffMinor, currency),
    currency: currency.toLowerCase(),
    duration: 'once',
    max_redemptions: 1,
    redeem_by: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000),
    name: COUPON_LABEL[kind],
    metadata: { wedillybird: kind },
  });
  return coupon.id;
}

const COUPON_LABEL: Record<
  'referral_credit' | 'affiliate_discount' | 'referral_credit_and_discount',
  string
> = {
  referral_credit: 'Crédit de parrainage Wedillybird',
  affiliate_discount: 'Remise partenaire Wedillybird',
  referral_credit_and_discount: 'Remise partenaire + crédit de parrainage Wedillybird',
};

/**
 * Crée un coupon plateforme. Exactement un de `percentOff` / `amountOffMinor`.
 * `durationInMonths` requis si `duration === 'repeating'`. `currency` requis
 * pour un montant fixe.
 */
export async function createCoupon(input: {
  name: string;
  percentOff?: number;
  amountOffMinor?: number;
  currency?: Currency;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths?: number;
  maxRedemptions?: number;
  redeemBy?: number; // ms epoch
  /**
   * Restreint le coupon à ces produits Stripe (`applies_to.products`). Vide /
   * absent = applicable à tous les produits. ⚠️ Immuable après création (Stripe
   * n'autorise pas la modif d'`applies_to`).
   */
  appliesToProducts?: string[];
}): Promise<AdminCoupon> {
  const stripe = getStripe();
  if ((input.percentOff == null) === (input.amountOffMinor == null)) {
    throw new Error('COUPON_NEEDS_PERCENT_XOR_AMOUNT');
  }
  if (input.amountOffMinor != null && !input.currency)
    throw new Error('COUPON_AMOUNT_NEEDS_CURRENCY');
  if (input.duration === 'repeating' && !input.durationInMonths) {
    throw new Error('COUPON_REPEATING_NEEDS_MONTHS');
  }

  const params: Stripe.CouponCreateParams = {
    name: input.name,
    duration: input.duration,
    ...(input.percentOff != null ? { percent_off: input.percentOff } : {}),
    ...(input.amountOffMinor != null
      ? { amount_off: input.amountOffMinor, currency: (input.currency ?? 'EUR').toLowerCase() }
      : {}),
    ...(input.duration === 'repeating' ? { duration_in_months: input.durationInMonths } : {}),
    ...(input.maxRedemptions != null ? { max_redemptions: input.maxRedemptions } : {}),
    ...(input.redeemBy != null ? { redeem_by: Math.floor(input.redeemBy / 1000) } : {}),
    ...(input.appliesToProducts && input.appliesToProducts.length > 0
      ? {
          applies_to: { products: input.appliesToProducts },
          // Trace la restriction en metadata : l'API dahlia ne renvoie plus
          // `applies_to` en lecture, donc mapCoupon la relit ici pour l'affichage
          // (le filtrage produit lui-même reste appliqué par Stripe).
          metadata: { wedillybird_applies_to: input.appliesToProducts.join(',') },
        }
      : {}),
  };
  const coupon = await stripe.coupons.create(params);
  return mapCoupon(coupon);
}

/**
 * Résout les IDs de **produits** Stripe des forfaits pros (Starter / Business /
 * Agency, mensuel + annuel) pour l'environnement courant — pour restreindre un
 * coupon aux abonnements pros via `applies_to.products` (geste « code promo
 * agences » qui ne doit pas marcher sur les forfaits couples ni le PAYG).
 *
 * En live, chaque (tier × cadence) est un produit Stripe distinct (6 au total).
 * Les variantes de devise (EUR/USD/MAD) d'un même tier × cadence partagent le
 * **même** produit → résoudre via EUR suffit à couvrir toutes les devises. On
 * lit les Price IDs via `priceIdForTier` (test en dev, live en prod), on
 * retrieve chaque prix et on déduplique les produits. Un variant dont l'env var
 * manque est ignoré (best effort).
 */
export async function resolveProPlanProductIds(): Promise<string[]> {
  const stripe = getStripe();
  const tiers: SubscriptionTier[] = ['starter', 'business', 'agency'];
  const billings: SubscriptionBilling[] = ['monthly', 'annual'];

  const priceIds = new Set<string>();
  for (const tier of tiers) {
    for (const billing of billings) {
      try {
        priceIds.add(priceIdForTier(tier, billing, 'EUR'));
      } catch {
        // Env var absente pour ce variant — on l'ignore.
      }
    }
  }

  const products = new Set<string>();
  for (const priceId of priceIds) {
    const price = await stripe.prices.retrieve(priceId);
    const product = typeof price.product === 'string' ? price.product : price.product?.id;
    if (product) products.add(product);
  }
  return [...products];
}

/**
 * Produits Stripe des forfaits COUPLE (Essentiel / Premium), résolus depuis
 * leurs Prices EUR — pendant B2C de `resolveProPlanProductIds`.
 *
 * Sert à restreindre un coupon partenaire (`applies_to.products`) : sans cette
 * restriction, le code d'une créatrice s'appliquerait aussi à un abonnement pro
 * (les checkouts pros ouvrent également `allow_promotion_codes`) — une remise
 * de 10 % offerte à son audience deviendrait 10 % sur un Agency à 449 €/mois.
 * La restriction est IMMUABLE après création côté Stripe : mieux vaut refuser
 * la création que créer un coupon trop large.
 *
 * Toutes les devises d'un même forfait partagent le même produit Stripe, donc
 * résoudre via EUR suffit.
 */
export async function resolveConsumerPlanProductIds(): Promise<string[]> {
  const stripe = getStripe();
  const priceIds = (['essential', 'premium'] as const)
    .map((plan) => priceIdForPlan(plan, 'EUR'))
    .filter((id): id is string => Boolean(id));

  const products = new Set<string>();
  for (const priceId of priceIds) {
    const price = await stripe.prices.retrieve(priceId);
    const product = typeof price.product === 'string' ? price.product : price.product?.id;
    if (product) products.add(product);
  }
  return [...products];
}

/**
 * Retrouve un code promo par sa chaîne lisible, ou `null`. Garde anti-doublon
 * avant d'en créer un : deux codes identiques rendraient l'attribution
 * ambiguë (on ne saurait plus quel affilié créditer).
 */
export async function findPromotionCodeByCode(code: string): Promise<AdminPromotionCode | null> {
  const stripe = getStripe();
  const res = await stripe.promotionCodes.list({ code, limit: 1 });
  const found = res.data[0];
  return found ? mapPromotionCode(found) : null;
}

export async function listCoupons(limit = 100): Promise<AdminCoupon[]> {
  const stripe = getStripe();
  const res = await stripe.coupons.list({ limit });
  return res.data.map(mapCoupon);
}

/** Supprime un coupon (les codes promo associés deviennent inutilisables). */
export async function deleteCoupon(couponId: string): Promise<{ id: string; deleted: boolean }> {
  const stripe = getStripe();
  const res = await stripe.coupons.del(couponId);
  return { id: res.id, deleted: Boolean(res.deleted) };
}

/**
 * Crée un code promo (lisible) rattaché à un coupon. `code` optionnel — Stripe
 * en génère un si omis. `restrictToFirstTime` limite aux nouveaux clients.
 */
export async function createPromotionCode(input: {
  couponId: string;
  code?: string;
  maxRedemptions?: number;
  expiresAt?: number; // ms epoch
  restrictToFirstTime?: boolean;
  minimumAmountMinor?: number;
  currency?: Currency;
}): Promise<AdminPromotionCode> {
  const stripe = getStripe();
  const params: Stripe.PromotionCodeCreateParams = {
    promotion: { type: 'coupon', coupon: input.couponId },
    ...(input.code ? { code: input.code } : {}),
    ...(input.maxRedemptions != null ? { max_redemptions: input.maxRedemptions } : {}),
    ...(input.expiresAt != null ? { expires_at: Math.floor(input.expiresAt / 1000) } : {}),
    ...(input.restrictToFirstTime || input.minimumAmountMinor != null
      ? {
          restrictions: {
            ...(input.restrictToFirstTime ? { first_time_transaction: true } : {}),
            ...(input.minimumAmountMinor != null
              ? {
                  minimum_amount: input.minimumAmountMinor,
                  minimum_amount_currency: (input.currency ?? 'EUR').toLowerCase(),
                }
              : {}),
          },
        }
      : {}),
  };
  const pc = await stripe.promotionCodes.create(params);
  return mapPromotionCode(pc);
}

function mapPromotionCode(pc: Stripe.PromotionCode): AdminPromotionCode {
  // Stripe v22 : le coupon est sous `promotion.coupon` (string id ou objet Coupon expand).
  const coupon = pc.promotion?.coupon ?? null;
  const couponObj = coupon && typeof coupon === 'object' ? coupon : null;
  const label = couponObj
    ? couponObj.percent_off === 100 &&
      couponObj.duration === 'repeating' &&
      couponObj.duration_in_months
      ? `${couponObj.duration_in_months} mois offerts`
      : couponObj.percent_off
        ? `${couponObj.percent_off}%`
        : couponObj.amount_off
          ? `${(couponObj.amount_off / 100).toFixed(0)} ${(couponObj.currency ?? '').toUpperCase()}`
          : (couponObj.name ?? couponObj.id)
    : typeof coupon === 'string'
      ? coupon
      : '—';
  return {
    id: pc.id,
    code: pc.code,
    couponId: couponObj ? couponObj.id : typeof coupon === 'string' ? coupon : '',
    couponLabel: label,
    active: pc.active,
    maxRedemptions: pc.max_redemptions ?? null,
    timesRedeemed: pc.times_redeemed ?? 0,
    expiresAt: pc.expires_at ? pc.expires_at * 1000 : null,
    createdAt: (pc.created ?? 0) * 1000,
  };
}

export async function listPromotionCodes(limit = 100): Promise<AdminPromotionCode[]> {
  const stripe = getStripe();
  const res = await stripe.promotionCodes.list({ limit });
  return res.data.map(mapPromotionCode);
}

/** Active/désactive un code promo (sans le supprimer — l'historique est gardé). */
export async function setPromotionCodeActive(
  promotionCodeId: string,
  active: boolean,
): Promise<AdminPromotionCode> {
  const stripe = getStripe();
  const pc = await stripe.promotionCodes.update(promotionCodeId, { active });
  return mapPromotionCode(pc);
}

/**
 * Applique une remise (coupon) directement à un abonnement existant — geste
 * commercial. La réduction s'applique aux prochaines factures selon la durée
 * du coupon.
 */
export async function applyCouponToSubscription(
  subscriptionId: string,
  couponId: string,
): Promise<{ id: string; discounted: boolean }> {
  const stripe = getStripe();
  // Stripe v22 : on passe par `discounts: [{ coupon }]` (remplace l'ancien `coupon`).
  const sub = await stripe.subscriptions.update(subscriptionId, {
    discounts: [{ coupon: couponId }],
  });
  return { id: sub.id, discounted: (sub.discounts?.length ?? 0) > 0 };
}

/** Retire la remise en cours d'un abonnement. */
export async function removeSubscriptionDiscount(subscriptionId: string): Promise<{ id: string }> {
  const stripe = getStripe();
  await stripe.subscriptions.deleteDiscount(subscriptionId);
  return { id: subscriptionId };
}
