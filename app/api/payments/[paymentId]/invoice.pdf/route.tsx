import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getLocale } from 'next-intl/server';
import { getActiveSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { buildInvoiceNumber, InvoicePDF, type InvoicePayment } from '@/lib/payments/invoice';

/**
 * GET /api/payments/{paymentId}/invoice.pdf
 *
 * Génère à la volée la facture PDF pour un paiement particulier (Essentiel /
 * Premium) déjà confirmé. Authentification : session HMAC obligatoire.
 *
 * 401 — pas de session
 * 403 — la session n'est ni l'acheteur ni l'owner de l'event
 * 404 — paiement introuvable / non payé
 * 200 — application/pdf, attachment + filename idempotent
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { paymentId } = await ctx.params;
  if (!paymentId) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const convex = getConvexServerClient();
  let result;
  try {
    result = await convex.query(convexApi.getPaymentForInvoice, {
      paymentId,
      requesterId: session.userId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    if (message === 'PAYMENT_NOT_FOUND' || message === 'PAYMENT_NOT_PAID') {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Locale = celle persistée sur l'user (préférée), sinon locale courante
  // de la requête (récupérée via next-intl). Permet à un user qui consulte
  // son PDF depuis un autre domaine localisé d'avoir le bon rendu.
  const locale = result.customer?.locale ?? (await getLocale());

  const invoicePayment: InvoicePayment = {
    paymentId: result.payment._id,
    invoiceNumber: buildInvoiceNumber(result.payment._id, result.payment.createdAt),
    issuedAt: result.payment.createdAt,
    paidAt: result.payment.updatedAt,
    plan: result.payment.plan,
    amountMinor: result.payment.amountMinor,
    currency: result.payment.currency,
    provider: result.payment.provider,
    customer: result.customer ?? {},
    eventTitle: result.event?.title,
    locale,
  };

  const buffer = await renderToBuffer(<InvoicePDF payment={invoicePayment} />);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="facture-wedillybird-${invoicePayment.invoiceNumber}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
