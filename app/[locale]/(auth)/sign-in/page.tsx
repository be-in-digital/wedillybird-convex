import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { safeNextPath } from '@/lib/auth/safe-next';
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
 * Sign-in V4 — server component qui délègue à AuthCard (animation Motion
 * niveau B sobre) + SignInForm (logique client OTP request).
 *
 * Eyebrow "ÉTAPE 01 — IDENTITÉ" pour ancrer l'esthétique éditoriale et
 * signaler à l'utilisateur que c'est le premier pas d'un parcours guidé.
 */
export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  // Destination a rejoindre apres connexion — typiquement `/rejoindre/<token>`
  // pour une partenaire. Validee ici : un `next` non filtre serait une
  // redirection ouverte (cf. `safeNextPath`).
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === 'string' ? sp.next : null);
  setRequestLocale(locale);
  const t = await getTranslations('Auth');
  const tCommon = await getTranslations('Common');

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
      <AuthMethodSwitcher next={next} />
    </AuthCard>
  );
}
