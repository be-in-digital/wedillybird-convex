import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { assertSameOrigin } from '@/lib/auth/csrf';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { PLANS } from '@/lib/payments/plans';
import { detectCountryFromHeaders, routePayment } from '@/lib/payments/country';
import { getPaymentDriver } from '@/lib/payments';
import { createOneTimeAmountCoupon } from '@/lib/payments/drivers/stripe';
import { splitOrderDiscounts } from '@/lib/payments/affiliate-discount';
import { captureServer, EVENTS } from '@/lib/analytics/posthog-server';

const bodySchema = z.object({
  eventId: z.string().min(1),
  plan: z.enum(['essential', 'premium']),
  currency: z.enum(['EUR', 'USD', 'MAD']).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const plan = parsed.plan;
  const country = detectCountryFromHeaders(req.headers);
  const routing = routePayment(country, {
    currency: parsed.currency,
  });
  const amountMinor = PLANS[plan].prices[routing.currency];
  if (amountMinor <= 0) {
    return NextResponse.json({ error: 'INVALID_PLAN_PRICE' }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const successUrl = `${origin}/events/${parsed.eventId}/upgrade/success`;
  const cancelUrl = `${origin}/events/${parsed.eventId}/upgrade/cancelled`;

  // Attribution affiliation : le proxy pose le cookie `wdb_ref` sur `?ref=CODE`.
  // On le résout en id d'affilié — best-effort strict : ne jamais bloquer le
  // checkout si la résolution échoue ou si le code est inconnu/inactif.
  //
  // On récupère aussi `buyerDiscountBps` : c'est la remise promise à l'audience
  // du partenaire. Jusqu'ici elle était stockée sur l'affilié mais jamais
  // appliquée — un code partenaire traçait la commission sans remiser personne.
  let affiliateId: string | undefined;
  let buyerDiscountBps = 0;
  const refCode = (await cookies()).get('wdb_ref')?.value;
  if (refCode) {
    try {
      const aff = await getConvexServerClient().query(convexApi.getAffiliateByCode, {
        code: refCode,
      });
      if (aff) {
        affiliateId = aff.id;
        buyerDiscountBps = aff.buyerDiscountBps;
      }
    } catch {
      // best-effort — l'attribution ne bloque jamais l'achat.
    }
  }

  // Remise affiliée + crédit de parrainage fusionnent dans UN SEUL coupon
  // (`discounts` n'accepte qu'une entrée côté Stripe). La remise s'applique en
  // premier, le crédit ne mord que sur le reliquat — sinon on réserverait du
  // crédit que le coupon n'applique pas (crédit brûlé pour rien).
  //
  // On RÉSERVE le crédit AVANT de créer le coupon : le montant réservé ==
  // la part crédit du coupon (jamais de sur-remise ni de crédit gratuit).
  // `reservationId` (token) est porté par la session (metadata) puis le
  // paiement, et consommé à la confirmation. Best-effort strict.
  const reservationId = crypto.randomUUID();
  let discountCouponId: string | undefined;
  let creditReserved = false;
  if (routing.provider === 'stripe') {
    const { discountMinor, creditBudgetMinor } = splitOrderDiscounts({
      orderMinor: amountMinor,
      buyerDiscountBps,
      creditAvailableMinor: 0,
    });
    try {
      const convex = getConvexServerClient();
      const reserved =
        creditBudgetMinor > 0
          ? await convex.mutation(convexApi.reserveCreditForCheckout, {
              userId: session.userId,
              reservationId,
              currency: routing.currency,
              orderMinor: creditBudgetMinor,
            })
          : { appliedMinor: 0 };
      creditReserved = reserved.appliedMinor > 0;
      const { couponMinor } = splitOrderDiscounts({
        orderMinor: amountMinor,
        buyerDiscountBps,
        creditAvailableMinor: reserved.appliedMinor,
      });
      if (couponMinor > 0) {
        discountCouponId = await createOneTimeAmountCoupon(
          couponMinor,
          routing.currency,
          discountMinor > 0 && creditReserved
            ? 'referral_credit_and_discount'
            : discountMinor > 0
              ? 'affiliate_discount'
              : 'referral_credit',
        );
      }
    } catch {
      // reserve OU création du coupon a échoué → relâche si on avait réservé.
      if (creditReserved) {
        try {
          await getConvexServerClient().mutation(convexApi.releaseCreditReservation, {
            reservationId,
          });
        } catch {
          // le GC cron rattrape.
        }
      }
      creditReserved = false;
      discountCouponId = undefined;
    }
  }
  const creditReservationId = creditReserved ? reservationId : undefined;

  const driver = getPaymentDriver(routing.provider);
  let session_;
  try {
    session_ = await driver.createCheckout({
      provider: routing.provider,
      plan,
      currency: routing.currency,
      amountMinor,
      eventId: parsed.eventId,
      userId: session.userId,
      successUrl,
      cancelUrl,
      affiliateId,
      discountCouponId,
      creditReservationId,
    });
  } catch (err) {
    // Session non créée → relâche le crédit réservé (sinon bloqué jusqu'au GC).
    if (creditReserved) {
      try {
        await getConvexServerClient().mutation(convexApi.releaseCreditReservation, {
          reservationId,
        });
      } catch {
        // le GC cron rattrape.
      }
    }
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  try {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.recordPaymentIntent, {
      userId: session.userId,
      eventId: parsed.eventId,
      plan,
      currency: routing.currency,
      amountMinor,
      provider: driver.name,
      providerSessionId: session_.providerSessionId,
      affiliateId,
      creditReservationId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    return NextResponse.json({ error: 'PAYMENT_RECORD_FAILED' }, { status: 500 });
  }

  // Analytics serveur : `checkout_started` est fiable même si le JS client est
  // bloqué. distinctId = userId Convex → se rattache à la personne identifiée
  // côté client. N'échoue jamais (garde interne) → ne casse pas la redirection.
  await captureServer({
    distinctId: session.userId,
    event: EVENTS.checkoutStarted,
    properties: {
      plan,
      currency: routing.currency,
      amount_minor: amountMinor,
      provider: driver.name,
      audience: 'consumer',
    },
  });

  return NextResponse.json({
    redirectUrl: session_.redirectUrl,
    provider: driver.name,
    currency: routing.currency,
    amountMinor,
  });
}
