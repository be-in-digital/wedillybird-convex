import { NextResponse } from 'next/server';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { setSessionCookie } from '@/lib/auth/session';
import { safeNextPath } from '@/lib/auth/safe-next';
import { verifyMagicLinkSchema } from '@/lib/validators/auth';
import { captureServer, EVENTS } from '@/lib/analytics/posthog-server';

/**
 * GET /api/auth/magic-link/verify?email=xxx&token=yyy
 *
 * Endpoint cliqué depuis l'email reçu. Valide le token, crée la session,
 * redirige vers /onboarding (si nouveau user) ou /dashboard.
 *
 * Échec → redirige vers /sign-in?error=<code> pour que la page sign-in
 * affiche un message friendly. On ne retourne pas le détail technique.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawEmail = url.searchParams.get('email');
  const rawToken = url.searchParams.get('token');

  const parsed = verifyMagicLinkSchema.safeParse({
    email: rawEmail,
    token: rawToken,
  });

  if (!parsed.success) {
    return NextResponse.redirect(new URL('/sign-in?error=invalid_link', request.url), {
      status: 303,
    });
  }

  const convex = getConvexServerClient();

  try {
    const result = await convex.mutation(convexApi.verifyMagicLink, {
      email: parsed.data.email,
      token: parsed.data.token,
    });

    await setSessionCookie({
      userId: result.userId,
      email: result.email,
      issuedAt: Date.now(),
    });

    // Nouveau compte (pas une reconnexion) créé via magic link email →
    // signup_completed côté serveur (fiable : le lien est ouvert hors contexte
    // client, pas de capture navigateur possible ici).
    if (result.isNewUser) {
      await captureServer({
        distinctId: result.userId,
        event: EVENTS.signupCompleted,
        properties: { method: 'email' },
      });
    }

    // Pas de phone (et email-only flow) : on envoie vers /onboarding pour
    // qu'ils complètent leur profil. Si le user existe déjà avec fullName
    // + role, /onboarding redirige vers /dashboard automatiquement (cf.
    // app/[locale]/(app)/onboarding/page.tsx).
    // Le lien peut porter une destination (`next`) — typiquement l'invitation
    // partenaire dont il est parti. Revalidee ici : l'URL a transite par une
    // boite mail, elle est modifiable par quiconque la recoit.
    const next = safeNextPath(url.searchParams.get('next'));
    return NextResponse.redirect(new URL(next ?? '/onboarding', request.url), { status: 303 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    const errorCode =
      message === 'LINK_EXPIRED'
        ? 'expired'
        : message === 'NO_ACTIVE_LINK'
          ? 'no_active_link'
          : message === 'INVALID_TOKEN'
            ? 'invalid_token'
            : 'unknown';
    return NextResponse.redirect(new URL(`/sign-in?error=${errorCode}`, request.url), {
      status: 303,
    });
  }
}
