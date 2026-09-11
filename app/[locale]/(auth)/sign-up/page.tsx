import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { redirectForSignedInVisitor } from '@/lib/auth/signed-in-visitor';
import { AuthCard } from '@/components/auth/auth-card';
import { AuthMethodSwitcher } from '@/components/auth/auth-method-switcher';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Auth' });
  return { title: t('signInTitle') };
}

/**
 * Sign-up — cible des CTA marketing (`/sign-up?plan=…&billing=…`). Le compte est
 * créé à la vérification OTP/magic link, donc le formulaire est le même qu'au
 * sign-in : on réutilise AuthCard + AuthMethodSwitcher. Seule différence,
 * `intent="signup"` déclenche l'analytics d'entrée de tunnel (signup_started)
 * que la page /sign-in n'émet pas.
 */
export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;

  // Deja connecte : le CTA d'acquisition ne doit pas ramener sur un formulaire
  // d'identite quelqu'un qui en a deja une. Meme aiguillage que /sign-in.
  const signedInDestination = redirectForSignedInVisitor({
    hasSession: (await getSession()) !== null,
  });
  if (signedInDestination) {
    redirect({ href: signedInDestination as never, locale });
  }

  setRequestLocale(locale);
  const t = await getTranslations('Auth');
  const tCommon = await getTranslations('Common');

  // plan/billing propagés par les CTA pricing (`/sign-up?plan=…&billing=…`),
  // lus côté serveur et passés en props pour enrichir l'event signup_started.
  const sp = await searchParams;
  const rawPlan = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const plan = rawPlan?.trim() || undefined;
  const rawBilling = Array.isArray(sp.billing) ? sp.billing[0] : sp.billing;
  const billing = rawBilling === 'monthly' || rawBilling === 'annual' ? rawBilling : undefined;

  return (
    <AuthCard
      eyebrow={t('stepOneEyebrow')}
      title={t('signInTitle')}
      description={t('signInDescription')}
      footer={
        <p className="text-center font-mono text-[10px] tracking-[0.24em] text-[color:var(--color-ink-500)] uppercase">
          <Link href="/" className="transition-colors hover:text-[color:var(--color-blush-700)]">
            ← {tCommon('back')}
          </Link>
        </p>
      }
    >
      <AuthMethodSwitcher intent="signup" plan={plan} billing={billing} />
    </AuthCard>
  );
}
