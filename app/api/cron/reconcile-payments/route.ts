import { NextResponse } from 'next/server';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { getPaymentDriver } from '@/lib/payments';
import { taxExclusiveMinor } from '@/lib/payments/vat';
import { captureServer, EVENTS } from '@/lib/analytics/posthog-server';

/**
 * Cron de réconciliation Stripe↔Convex des paiements `pending` (T2-2).
 *
 * *Pourquoi* : un couple qui ferme l'onglet avant `/upgrade/success` alors
 * que le webhook Stripe a été manqué (5xx transitoire, déploiement en cours…)
 * reste bloqué indéfiniment — rien ne relance la réconciliation. Filet de
 * sécurité additif : le webhook (`app/api/webhooks/[provider]/route.ts`) et
 * le filet best-effort de la success-page restent inchangés, ce cron couvre
 * le cas où AUCUN des deux n'a abouti.
 *
 * *Règle money-path impérative* : on ne marque JAMAIS rien sans re-vérifier
 * le statut RÉEL côté Stripe (`getPaymentDriver().retrieveSessionStatus`)
 * d'abord, et on applique la MÊME `markPaymentSucceeded` gardée par
 * `CONVEX_WEBHOOK_SECRET` que le webhook — jamais un marquage forgé depuis le
 * cron. Un paiement dont Stripe dit qu'il n'est PAS payé reste `pending` : on
 * alerte (`payment_reconciliation_stuck`), on ne force jamais `markFailed`
 * (un checkout encore ouvert peut aboutir une minute plus tard).
 *
 * Vercel Cron (voir `vercel.json`) invoque cette route en GET avec un header
 * `Authorization: Bearer $CRON_SECRET` — comportement automatique de Vercel
 * dès que la variable d'env `CRON_SECRET` est posée.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

// Un paiement `pending` depuis plus de 30 min est anormal (un checkout Stripe
// normal se résout en quelques minutes) — seuil du plan de lancement T2-2.
const STALE_AFTER_MS = 30 * 60 * 1000;

function isAuthorizedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Pas de fallback silencieux : une env absente rejette TOUT (même politique
  // que `assertWebhookSecret`) plutôt que d'exposer la route sans protection.
  if (!expected) return false;
  return req.headers.get('authorization') === `Bearer ${expected}`;
}

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const webhookSecret = process.env.CONVEX_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'WEBHOOK_SECRET_NOT_CONFIGURED' }, { status: 500 });
  }

  const convex = getConvexServerClient();

  let stalePayments;
  try {
    stalePayments = await convex.query(convexApi.listStalePendingPayments, {
      webhookSecret,
      olderThanMs: STALE_AFTER_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    await captureServer({
      distinctId: 'system:reconcile-payments-cron',
      event: EVENTS.webhookProcessingFailed,
      properties: { source: 'reconcile_cron_list', message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let recovered = 0;
  let stillPending = 0;
  let errors = 0;

  for (const payment of stalePayments) {
    try {
      const driver = getPaymentDriver(payment.provider);
      const status = await driver.retrieveSessionStatus(payment.providerSessionId);

      if (!status.paid) {
        // Stripe confirme : toujours pas payé. On n'écrit rien — on alerte.
        stillPending += 1;
        await captureServer({
          distinctId: `system:reconcile-payments-cron`,
          event: EVENTS.paymentReconciliationStuck,
          properties: {
            payment_id: payment._id,
            event_id: payment.eventId,
            provider: payment.provider,
            plan: payment.plan,
            pending_for_ms: Date.now() - payment.createdAt,
          },
        });
        continue;
      }

      // Confirmé payé côté Stripe → même mutation gardée que le webhook.
      // Idempotent (`alreadyApplied`) : sûr même si le webhook arrive juste après.
      const result = await convex.mutation(convexApi.markPaymentSucceeded, {
        webhookSecret,
        provider: payment.provider,
        providerSessionId: status.providerSessionId,
        providerEventId: status.providerEventId,
        // Mêmes bases que le webhook pour l'affiliation (net encaissé, assiette
        // HT, code promo). Le driver mock ne connaît pas le montant → on ne le
        // passe pas.
        ...(payment.provider === 'stripe'
          ? {
              netMinor: status.amountMinor,
              commissionBaseMinor: taxExclusiveMinor(status.amountMinor, status.currency),
              promotionCode: status.promotionCode,
            }
          : {}),
      });

      if (!result.alreadyApplied) {
        recovered += 1;
        // Miroir de l'analytics du webhook (route.ts) : un paiement récupéré
        // par le cron est un achat réel, il doit compter dans le revenu.
        // Exclut `mock` (paiements de test), comme le webhook.
        if (payment.provider === 'stripe') {
          await captureServer({
            distinctId: payment.userId,
            event: EVENTS.purchaseCompleted,
            properties: {
              plan: payment.plan,
              currency: payment.currency,
              amount_minor: payment.amountMinor,
              revenue: payment.amountMinor / 100,
              event_id: payment.eventId,
              provider: payment.provider,
              recovered_by: 'reconciliation_cron',
              $set: { plan_tier: payment.plan },
            },
          });
        }
      }
    } catch (err) {
      errors += 1;
      const message = err instanceof Error ? err.message : 'UNKNOWN';
      await captureServer({
        distinctId: 'system:reconcile-payments-cron',
        event: EVENTS.webhookProcessingFailed,
        properties: {
          source: 'reconcile_cron_payment',
          payment_id: payment._id,
          event_id: payment.eventId,
          provider: payment.provider,
          message,
        },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: stalePayments.length,
    recovered,
    stillPending,
    errors,
  });
}
