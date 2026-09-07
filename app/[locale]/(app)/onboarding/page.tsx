import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { isAgencyRole, resolvePostAuthDestination } from '@/lib/auth/post-auth-destination';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Onboarding' });
  return { title: t('stepProfile') };
}

/**
 * Onboarding V4 — server component qui valide la session puis délègue au
 * wizard client. Le layout split éditorial est dans `./layout.tsx`.
 */
export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) {
    redirect({ href: '/sign-in', locale });
  }

  const convex = getConvexServerClient();
  const user = await convex.query(convexApi.currentUser, { userId: session!.userId });

  // Déjà onboardé : on renvoie vers le bon dashboard (agence vs particulier)
  // plutôt que systématiquement vers /dashboard.
  if (user?.fullName && user.role && user.role !== 'guest') {
    const hasActiveOrg = isAgencyRole(user.role)
      ? Boolean(await convex.query(convexApi.myOrganization, { userId: session!.userId }))
      : false;
    redirect({ href: resolvePostAuthDestination(user, hasActiveOrg), locale });
  }

  // Politique d'identité unique (avril 2026) : un user doit avoir À LA FOIS
  // un email ET un numéro WhatsApp pour finaliser l'onboarding. Ça évite les
  // doublons (même personne, deux comptes) et donne une voie de recovery si
  // un canal est perdu.
  // - Si l'user vient de magic link → email déjà rempli, on demandera le phone.
  // - Si l'user vient de WhatsApp → phone déjà rempli, on demandera l'email.
  // `initialRole` : un compte peut arriver ici avec un rôle déjà posé mais sans
  // nom — un admin promu par ADMIN_PHONE/ADMIN_EMAIL, ou un partenaire passé
  // `pro` en consommant son lien d'invitation. Le wizard masque alors le step
  // « rôle » (le lui demander le rétrograderait).
  return (
    <OnboardingWizard
      initialEmail={user?.email ?? ''}
      initialPhone={user?.phone ?? ''}
      initialRole={user?.role ?? null}
    />
  );
}
