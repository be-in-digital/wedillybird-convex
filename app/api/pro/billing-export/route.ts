import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { listSubscriptionInvoices } from '@/lib/payments/drivers/stripe';
import {
  buildBillingCsv,
  inMonth,
  BILLING_INVOICE_STATUS,
  type BillingExportRow,
  type BillingInvoiceStatus,
} from '@/lib/pro/billing-export';

/**
 * GET /api/pro/billing-export?month=YYYY-MM
 *
 * Relevé comptable de la facturation agence (factures d'abonnement Stripe +
 * crédits Pay-as-you-go) pour un mois donné, en CSV (séparateur `;`, BOM UTF-8
 * pour Excel). Authentification : session HMAC obligatoire.
 *
 * 401 — pas de session · 404 — pas d'organisation · 200 — text/csv attachment.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await getActiveSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const month = new URL(req.url).searchParams.get('month') ?? '';

  const convex = getConvexServerClient();
  const org = await convex.query(convexApi.myOrganization, { userId: session.userId });
  if (!org) return NextResponse.json({ error: 'NO_ORG' }, { status: 404 });

  const rows: BillingExportRow[] = [];

  // Crédits Pay-as-you-go (source Convex réelle).
  try {
    const payg = await convex.query(convexApi.listPaygPurchasesByOrganization, {
      organizationId: org._id,
      requesterId: session.userId,
    });
    for (const p of payg) {
      rows.push({
        date: p.createdAt,
        type: 'PAYG',
        reference: p.stripeSessionId,
        amountMinor: p.amountMinor,
        currency: p.currency,
        status: 'Payée',
      });
    }
  } catch {
    /* pas de crédits / accès refusé → ignore */
  }

  // Factures d'abonnement (Stripe — réel en prod, vide si non configuré).
  if (org.stripeCustomerId) {
    try {
      const invoices = await listSubscriptionInvoices(org.stripeCustomerId, 100);
      for (const inv of invoices) {
        rows.push({
          date: inv.date,
          type: 'Abonnement',
          reference: inv.id,
          amountMinor: inv.amountMinor,
          currency: inv.currency,
          status: BILLING_INVOICE_STATUS[inv.status as BillingInvoiceStatus]?.label ?? inv.status,
        });
      }
    } catch {
      /* Stripe non configuré → on exporte juste le PAYG */
    }
  }

  const filtered = (month ? rows.filter((r) => inMonth(r.date, month)) : rows).sort(
    (a, b) => b.date - a.date,
  );
  const csv = buildBillingCsv(filtered);
  const filename = `wedillybird-facturation-${month || 'tout'}.csv`;

  // BOM UTF-8 pour qu'Excel ouvre les accents correctement.
  return new Response(`﻿${csv}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
