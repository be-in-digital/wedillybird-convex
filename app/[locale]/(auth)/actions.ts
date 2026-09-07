'use server';

import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import {
  requestMagicLinkSchema,
  requestOtpSchema,
  verifyOtpSchema,
  onboardingSchema,
} from '@/lib/validators/auth';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { clearSessionCookie, getSession, setSessionCookie } from '@/lib/auth/session';
import { isAgencyRole, resolvePostAuthDestination } from '@/lib/auth/post-auth-destination';
import { asBudgetCurrency } from '@/lib/currency';
import { safeNextPath } from '@/lib/auth/safe-next';

type ActionResult =
  | { ok: true; phone?: string; email?: string; isNewUser?: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function requestOtpAction(formData: FormData): Promise<ActionResult> {
  const parsed = requestOtpSchema.safeParse({ phone: formData.get('phone') });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'INVALID_INPUT',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const convex = getConvexServerClient();
  const headersList = await headers();
  const ipAddress =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    undefined;

  try {
    await convex.action(convexApi.requestOtp, {
      phone: parsed.data.phone,
      ...(ipAddress ? { ipAddress } : {}),
    });
    return { ok: true, phone: parsed.data.phone };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'UNKNOWN' };
  }
}

export async function verifyOtpAction(formData: FormData): Promise<ActionResult> {
  const parsed = verifyOtpSchema.safeParse({
    phone: formData.get('phone'),
    code: formData.get('code'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'INVALID_INPUT',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const convex = getConvexServerClient();

  try {
    const result = await convex.mutation(convexApi.verifyOtp, {
      phone: parsed.data.phone,
      code: parsed.data.code,
    });

    await setSessionCookie({
      userId: result.userId,
      phone: result.phone,
      issuedAt: Date.now(),
    });

    return { ok: true, phone: result.phone, isNewUser: result.isNewUser };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'UNKNOWN' };
  }
}

export async function completeOnboardingAction(formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };

  const parsed = onboardingSchema.safeParse({
    fullName: formData.get('fullName') ?? undefined,
    role: formData.get('role') ?? undefined,
    email: formData.get('email') ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'INVALID_INPUT',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const convex = getConvexServerClient();
  const rawCurrency = formData.get('currency');
  const preferredCurrency =
    typeof rawCurrency === 'string' && rawCurrency.length > 0
      ? asBudgetCurrency(rawCurrency)
      : undefined;

  try {
    await convex.mutation(convexApi.completeOnboarding, {
      userId: session.userId,
      fullName: parsed.data.fullName,
      ...(parsed.data.role ? { role: parsed.data.role } : {}),
      email: parsed.data.email,
      ...(preferredCurrency ? { preferredCurrency } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    if (message.includes('EMAIL_TAKEN')) {
      return {
        ok: false,
        error: 'EMAIL_TAKEN',
        fieldErrors: { email: ['EMAIL_TAKEN'] },
      };
    }
    return { ok: false, error: message };
  }

  // Aiguillage agence vs particulier : un pro fraîchement onboardé n'a pas
  // encore d'organisation → /pro/onboarding ; un couple → /dashboard.
  const locale = await getLocale();
  const onboardedUser = await convex.query(convexApi.currentUser, { userId: session.userId });
  const hasActiveOrg = isAgencyRole(onboardedUser?.role)
    ? Boolean(await convex.query(convexApi.myOrganization, { userId: session.userId }))
    : false;
  const destination = resolvePostAuthDestination(onboardedUser, hasActiveOrg);
  redirect({ href: destination, locale });
  return { ok: true };
}

/**
 * Magic Link — fallback auth pour les utilisateurs sans WhatsApp.
 *
 * Côté serveur, on déclenche l'action Convex requestMagicLink qui :
 *  1. valide l'email
 *  2. vérifie le rate limit (3/h par email)
 *  3. génère un token 256 bits + sauvegarde le hash
 *  4. envoie l'email via SES (driver mock en dev)
 *
 * On NE lève PAS d'erreur pour 'NO_USER' — on retourne ok:true même si
 * l'email n'existe pas, pour empêcher l'énumération des comptes (best
 * practice anti user-enumeration).
 */
export async function requestMagicLinkAction(formData: FormData): Promise<ActionResult> {
  const parsed = requestMagicLinkSchema.safeParse({ email: formData.get('email') });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'INVALID_INPUT',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const convex = getConvexServerClient();
  const headersList = await headers();
  const ipAddress =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    undefined;

  const locale = await getLocale();
  // Revalide cote serveur : le formulaire est du code client, la valeur qui
  // arrive ici n'est jamais une preuve.
  const next = safeNextPath(
    typeof formData.get('next') === 'string' ? String(formData.get('next')) : null,
  );
  try {
    await convex.action(convexApi.requestMagicLink, {
      email: parsed.data.email,
      ...(ipAddress ? { ipAddress } : {}),
      ...(next ? { next } : {}),
      locale,
    });
    return { ok: true, email: parsed.data.email };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'UNKNOWN' };
  }
}

export async function signOutAction(): Promise<void> {
  await clearSessionCookie();
  const locale = await getLocale();
  redirect({ href: '/', locale });
}
