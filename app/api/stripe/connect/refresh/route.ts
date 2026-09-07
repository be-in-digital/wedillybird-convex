import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { createAccountOnboardingLink } from '@/lib/payments/drivers/stripe';
import { appOrigin } from '@/lib/reminders/window';

/**
 * Lien d'onboarding expiré ou abandonné → Stripe rappelle ici. On régénère un
 * lien d'onboarding et on renvoie l'agence vers Stripe pour reprendre là où elle
 * s'était arrêtée. Échec gracieux → /pro/payments?connect=error.
 */
export async function GET(req: Request): Promise<Response> {
  const fail = () => NextResponse.redirect(new URL('/pro/payments?connect=error', req.url));

  const session = await getActiveSession();
  if (!session) return fail();

  try {
    const convex = getConvexServerClient();
    const org = await convex.query(convexApi.myOrganization, { userId: session.userId });
    if (!org) return fail();
    if (org.myRole !== 'owner' && org.myRole !== 'admin') return fail();

    const conn = await convex.query(convexApi.orgConnectStatus, {
      organizationId: org._id,
      requesterId: session.userId,
    });
    if (!conn.accountId) return fail();

    const origin = appOrigin();
    const { url } = await createAccountOnboardingLink({
      accountId: conn.accountId,
      refreshUrl: `${origin}/api/stripe/connect/refresh`,
      returnUrl: `${origin}/api/stripe/connect/return`,
    });
    return NextResponse.redirect(url);
  } catch {
    return fail();
  }
}
