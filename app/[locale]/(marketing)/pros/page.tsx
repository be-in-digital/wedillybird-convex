import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { OG_DEFAULT_IMAGES, TWITTER_DEFAULT_IMAGES } from '@/lib/seo/og';
import { toOgLocale } from '@/lib/i18n/locale-tags';
import { Link } from '@/i18n/navigation';
import { WedillybirdLogo } from '@/components/brand/wedillybird-logo';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { LandingFooterRich } from '@/components/landing/footer-rich';
import { HeaderCta } from '@/components/landing/header-cta';
import { ProsHero } from '@/components/pros/pros-hero';
import { ProsJourney } from '@/components/pros/pros-journey';
import { ProsWedge } from '@/components/pros/pros-wedge';
import { ProsPillars } from '@/components/pros/pros-pillars';
import { ProsWhiteLabel } from '@/components/pros/pros-whitelabel';
import { ProsPricing } from '@/components/pros/pros-pricing';
import { ProsFaq } from '@/components/pros/pros-faq';
import { ProsCta } from '@/components/pros/pros-cta';
import { defaultCurrencyForLocale } from '@/lib/payments/currency';
import type { Locale } from '@/i18n/routing';

const NAV_LINKS = [
  { href: '#fonctionnalites', labelKey: 'nav.features' },
  { href: '#tarifs', labelKey: 'nav.pricing' },
  { href: '#faq', labelKey: 'nav.faq' },
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Marketing.pros' });
  const title = t('metaTitle');
  const description = t('metaDescription');
  return {
    title,
    description,
    alternates: { canonical: '/pros' },
    openGraph: {
      type: 'website',
      title,
      description,
      url: '/pros',
      siteName: 'Wedillybird',
      locale: toOgLocale(locale),
      images: [...OG_DEFAULT_IMAGES],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [...TWITTER_DEFAULT_IMAGES],
    },
  };
}

export default async function ProsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Marketing.pros');
  const tCommon = await getTranslations('Common');
  const defaultCurrency = defaultCurrencyForLocale(locale as Locale);

  return (
    <>
      {/* Header sticky — logo, ancres (desktop), langue + CTA */}
      <header className="sticky top-0 z-30 border-b border-[color:var(--color-border)] bg-[color:var(--color-ivory-50)]/85 backdrop-blur supports-[backdrop-filter]:bg-[color:var(--color-ivory-50)]/65">
        <div className="container-page flex items-center justify-between gap-4 py-4 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-6">
          <div className="flex items-center">
            <Link
              href="/"
              className="focus-ring inline-flex items-center"
              aria-label={t('logoHome')}
            >
              <WedillybirdLogo priority />
            </Link>
          </div>

          <nav
            aria-label={t('navAriaLabel')}
            className="hidden items-center justify-center gap-7 md:flex"
          >
            {NAV_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="font-mono text-[10px] tracking-[0.24em] text-[color:var(--color-ink-500)] uppercase transition-colors hover:text-[color:var(--color-ink-900)]"
              >
                {t(item.labelKey)}
              </a>
            ))}
          </nav>

          <div className="flex items-center justify-end gap-2 md:gap-3">
            <LocaleSwitcher className="hidden md:inline-flex" />
            <span aria-hidden className="hidden h-5 w-px bg-[color:var(--color-border)] md:block" />
            {/* Même raison que sur la landing : sans lien de connexion, une
                agence déjà cliente n'a aucun point d'entrée pour revenir. */}
            <HeaderCta
              href="/sign-in"
              label={tCommon('signIn')}
              source="pros_header"
              destination="/sign-in"
              variant="ghost"
              audience="pro"
              className="hidden sm:inline-flex"
            />
            <HeaderCta
              href="/sign-up?plan=business&billing=monthly"
              label={t('cta')}
              source="pros_header"
              destination="/sign-up"
              plan="business"
              billing="monthly"
              audience="pro"
            />
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1" tabIndex={-1}>
        <ProsHero />
        <ProsJourney />
        <ProsWedge />
        <ProsPillars />
        <ProsWhiteLabel />
        <ProsPricing defaultCurrency={defaultCurrency} />
        <ProsFaq />
        <ProsCta />
      </main>

      <LandingFooterRich />
    </>
  );
}
