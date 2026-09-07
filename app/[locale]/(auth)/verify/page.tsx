import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Link, redirect } from '@/i18n/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { safeNextPath } from '@/lib/auth/safe-next';
import { VerifyForm } from '@/components/auth/verify-form';
import { isValidE164, maskPhone } from '@/lib/phone';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Auth' });
  return { title: t('verifyTitle') };
}

/**
 * Verify V4 — server component qui valide le téléphone E.164 puis affiche
 * le form OTP côté client. Eyebrow "ÉTAPE 02 — VÉRIFICATION" pour signaler
 * la progression dans le parcours.
 */
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const rawPhone = sp.phone;
  const phone = Array.isArray(rawPhone) ? rawPhone[0] : rawPhone;
  // Revalide a chaque etape plutot que de faire confiance a l'etape d'avant :
  // cette URL est partageable et editable a la main.
  const next = safeNextPath(typeof sp.next === 'string' ? sp.next : null);

  if (!phone || !isValidE164(phone)) {
    redirect({ href: '/sign-in', locale });
  }

  const t = await getTranslations('Auth');

  return (
    <AuthCard
      eyebrow={t('stepTwoEyebrow')}
      title={t('verifyTitle')}
      description={t('verifyDescription', { phone: maskPhone(phone!) })}
      footer={
        <p className="text-center font-mono text-[10px] tracking-[0.24em] text-[color:var(--color-ink-500)] uppercase">
          <Link
            href="/sign-in"
            className="transition-colors hover:text-[color:var(--color-blush-700)]"
          >
            ← {t('changeNumber')}
          </Link>
        </p>
      }
    >
      <VerifyForm phone={phone!} next={next} />
    </AuthCard>
  );
}
