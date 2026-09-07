import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getActiveSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { getUpsellPrice } from '@/lib/payments/plans';
import { detectCountryFromHeaders, routePayment } from '@/lib/payments/country';
import {
  createPostEventUpsellCheckout,
  createOneTimeAmountCoupon,
} from '@/lib/payments/drivers/stripe';
import { captureServer, EVENTS } from '@/lib/analytics/posthog-server';

/**
 * Démarre le checkout de l'upsell HD post-event (+29 €). Paiement one-shot
 * **plateforme** (compte Wedillybird, pas Connect), réservé aux events déjà
 * payés (`planTier` défini). À l'inverse des forfaits, on n'enregistre PAS de
 * `recordIntent` : l'event est appliqué à la confirmation Stripe via
 * `payments:applyPostEventUpsell` (webhook + fallback page de succès).
 *
 * Stripe-only (comme PAYG / abonnements) : pas de chemin mock.
 */
const bodySchema = z.object({
  eventId: z.string().min(1),
  currency: z.enum(['EUR', 'USD', 'MAD']).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const convex = getConvexServerClient();

  // Vérifie que le demandeur possède bien l'event ET qu'il est éligible :
  // l'upsell ne s'achète qu'une fois, sur un event déjà payé.
  const event = await convex.query(convexApi.getEventById, {
    eventId: parsed.eventId,
    requesterId: session.userId,
  });
  if (!event) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  if (!event.planTier) {
    return NextResponse.json({ error: 'PLAN_REQUIRED' }, { status: 409 });
  }
  if (event.hdUpsellPurchasedAt) {
    return NextResponse.json({ error: 'ALREADY_PURCHASED' }, { status: 409 });
  }

  const country = detectCountryFromHeaders(req.headers);
  const routing = routePayment(country, { currency: parsed.currency });
  const amountMinor = getUpsellPrice(routing.currency);
  if (amountMinor <= 0) {
    return NextResponse.json({ error: 'INVALID_PLAN_PRICE' }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const successUrl = `${origin}/events/${parsed.eventId}/upsell/success`;
  const cancelUrl = `${origin}/events/${parsed.eventId}/upgrade/cancelled`;

  // Crédit de parrainage : le parrain dépense son crédit sur l'upsell HD (le
  // rachat le plus fréquent pour un couple one-shot). On RÉSERVE avant de créer
  // le coupon ; le token voyage par la metadata de session et est consommé à la
  // confirmation (`applyPostEventUpsell`). Best-effort strict.
  const reservationId = crypto.randomUUID();
  let discountCouponId: string | undefined;
  let creditReserved = false;
  try {
    const reserved = await convex.mutation(convexApi.reserveCreditForCheckout, {
      userId: session.userId,
      reservationId,
      currency: routing.currency,
      orderMinor: amountMinor,
    });
    if (reserved.appliedMinor > 0) {
      creditReserved = true;
      discountCouponId = await createOneTimeAmountCoupon(reserved.appliedMinor, routing.currency);
    }
  } catch {
    if (creditReserved) {
      try {
        await convex.mutation(convexApi.releaseCreditReservation, { reservationId });
      } catch {
        // le GC cron rattrape.
      }
    }
    creditReserved = false;
    discountCouponId = undefined;
  }
  const creditReservationId = creditReserved ? reservationId : undefined;

  let checkout;
  try {
    checkout = await createPostEventUpsellCheckout({
      eventId: parsed.eventId,
      userId: session.userId,
      currency: routing.currency,
      amountMinor,
      successUrl,
      cancelUrl,
      discountCouponId,
      creditReservationId,
    });
  } catch (err) {
    if (creditReserved) {
      try {
        await convex.mutation(convexApi.releaseCreditReservation, { reservationId });
      } catch {
        // le GC cron rattrape.
      }
    }
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await captureServer({
    distinctId: session.userId,
    event: EVENTS.checkoutStarted,
    properties: {
      plan: 'post_event_upsell',
      currency: routing.currency,
      amount_minor: amountMinor,
      provider: 'stripe',
      audience: 'consumer',
    },
  });

  return NextResponse.json({
    redirectUrl: checkout.redirectUrl,
    provider: 'stripe',
    currency: routing.currency,
    amountMinor,
  });
}
