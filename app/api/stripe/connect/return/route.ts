import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { retrieveConnectedAccountStatus } from '@/lib/payments/drivers/stripe';

/**
 * Retour de l'onboarding Stripe hébergé. On rafraîchit le statut du compte
 * connecté de l'agence (charges / details / payouts) puis on redirige vers
 * /pro/payments : `connect=ok` si l'agence peut encaisser, `connect=incomplete`
 * si l'onboarding n'est pas terminé.
 */
export async function GET(req: Request): Promise<Response> {
  const back = (status: 'ok' | 'incomplete' | 'error') =>
    NextResponse.redirect(new URL(`/pro/payments?connect=${status}`, req.url));

  const session = await getActiveSession();
  if (!session) return back('error');

  try {
    const convex = getConvexServerClient();
    const org = await convex.query(convexApi.myOrganization, { userId: session.userId });
    if (!org) return back('error');
    if (org.myRole !== 'owner' && org.myRole !== 'admin') return back('error');

    const conn = await convex.query(convexApi.orgConnectStatus, {
      organizationId: org._id,
      requesterId: session.userId,
    });
    if (!conn.accountId) return back('error');

    const st = await retrieveConnectedAccountStatus(conn.accountId);
    await convex.mutation(convexApi.updateConnectStatus, {
      organizationId: org._id,
      requesterId: session.userId,
      chargesEnabled: st.chargesEnabled,
      detailsSubmitted: st.detailsSubmitted,
      payoutsEnabled: st.payoutsEnabled,
    });
    return back(st.chargesEnabled ? 'ok' : 'incomplete');
  } catch {
    return back('error');
  }
}
