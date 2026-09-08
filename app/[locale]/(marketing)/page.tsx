import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { OG_DEFAULT_IMAGES, TWITTER_DEFAULT_IMAGES } from '@/lib/seo/og';
import { toOgLocale } from '@/lib/i18n/locale-tags';
import { Link } from '@/i18n/navigation';
import { LenisProvider } from '@/components/landing/lenis-provider';
import { HeaderCta } from '@/components/landing/header-cta';
import { LandingHero } from '@/components/landing/hero';
import { LandingManifesto } from '@/components/landing/manifesto';
import { LandingFeaturesGrid } from '@/components/landing/features-grid';
import { LandingChannels } from '@/components/landing/channels';
import { LandingCinematicInvitation } from '@/components/landing/cinematic-invitation';
import { LandingPricingCards } from '@/components/landing/pricing-cards';
import { MobileMenu } from '@/components/landing/mobile-menu';
import { LandingFaqAccordion } from '@/components/landing/faq-accordion';
import { LandingCtaFinal } from '@/components/landing/cta-final';
import { LandingFooterRich } from '@/components/landing/footer-rich';
import { SectionNav } from '@/components/landing/section-nav';
import { WedillybirdLogo } from '@/components/brand/wedillybird-logo';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { defaultCurrencyForLocale } from '@/lib/payments/currency';
import type { Locale } from '@/i18n/routing';

// Mêmes clés que l'accordion client (faq-accordion.tsx). `africa3g` retiré du
// parcours couple US (hors-sujet marché de lancement) — clé i18n conservée pour
// la parité, non rendue.
const FAQ_KEYS = [
  'whyWhatsapp',
  'olderGuests',
  'guestLimit',
  'cancellation',
  'afterEvent',
  'branding',
  'data',
] as const;

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Metadata.landing' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      url: BASE_URL,
      siteName: 'Wedillybird',
      title: t('title'),
      description: t('description'),
      locale: toOgLocale(locale),
      images: [...OG_DEFAULT_IMAGES],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: [...TWITTER_DEFAULT_IMAGES],
    },
  };
}

/**
 * Landing page V5 — direction "mariage éditorial Awwwards-grade".
 *
 * V4 = refonte post-audit design (V3 jugée 64/100). V5 = audit trafic &
 * conversion de sept. 2026 (`docs/landing-audit-2026-09.md`) : promesse
 * concrète et CTA au-dessus du pli, démo publique `/demo`, et retrait de toute
 * preuve sociale non mesurée (stats du manifeste, section Témoignages avec
 * trois voix fictives, « 1 240 mariages » / « 4,9 / 5 »).
 *
 * Structure narrative :
 *  01. Hero (promesse + carte d'invitation 3D + photo couple Provence)
 *  02. Manifesto (lede + diptyque + pull-quote)
 *  03. 4 piliers (asymétrie : Invitations large + 3 cards)
 *  03b. Canaux (SMS US/CA, WhatsApp ailleurs)
 *  04. Cinématique invitation (texture papier + sceau fendu + cursor cire)
 *  06. Pricing (geoIP auto, sparkle gold Premium hover)
 *  07. FAQ (7 questions accordion)
 *  Épilogue. CTA final + Footer riche
 *
 * Note : la landing est mono-audience "couple". L'offre Pro (features +
 * pricing agence) vit sur /pros, retirée du scroll couple pour ne pas diluer
 * le message ni brouiller le signal d'audience côté acquisition.
 *
 * Smooth scroll Lenis sur toute la landing.
 *
 * SEO : JSON-LD FAQPage côté server (mêmes clés que l'accordion client).
 */
export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const defaultCurrency = defaultCurrencyForLocale(locale as Locale);

  const tFaq = await getTranslations({ locale, namespace: 'Landing.faq.items' });
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_KEYS.map((key) => ({
      '@type': 'Question',
      name: tFaq(`${key}.q`),
      acceptedAnswer: {
        '@type': 'Answer',
        text: tFaq(`${key}.a`),
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LandingShell defaultCurrency={defaultCurrency} />
    </>
  );
}

function LandingShell({
  defaultCurrency,
}: {
  defaultCurrency: ReturnType<typeof defaultCurrencyForLocale>;
}) {
  const tCommon = useTranslations('Common');
  const tm = useTranslations('Marketing.landing');

  return (
    <LenisProvider>
      {/* Top nav — sticky, layout 3 colonnes : logo gauche, nav centrée,
          CTA droite. Grid 3-cols pour que la nav soit vraiment centrée
          dans le viewport indépendamment de la largeur du logo et du CTA
          (un flex justify-between recentre faussement, biaisé par les
          tailles asymétriques des blocs latéraux). */}
      <header className="sticky top-0 z-30 border-b border-[color:var(--color-border)] bg-[color:var(--color-ivory-50)]/85 backdrop-blur supports-[backdrop-filter]:bg-[color:var(--color-ivory-50)]/65">
        <div className="container-page flex items-center justify-between gap-4 py-4 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-6">
          {/* Colonne gauche : logo */}
          <div className="flex items-center">
            <Link
              href="/"
              className="focus-ring inline-flex items-center"
              aria-label={tCommon('appName')}
            >
              <WedillybirdLogo priority />
            </Link>
          </div>

          {/* Colonne centrale : navigation éditoriale */}
          <nav
            aria-label={tm('navAriaLabel')}
            className="hidden items-center justify-center gap-7 md:flex"
          >
            <SectionNav />
          </nav>

          {/* Colonne droite — desktop : sélecteur de langue + CTA primary
              (un seul bouton car le flow OTP WhatsApp unifie sign-in/sign-up).
              Mobile : CTA sign-up reste visible à côté du hamburger qui héberge
              nav + locale dans un bottom-sheet Vaul. */}
          <div className="flex items-center justify-end gap-2 md:gap-3">
            <LocaleSwitcher className="hidden md:inline-flex" />
            <span aria-hidden className="hidden h-5 w-px bg-[color:var(--color-border)] md:block" />
            <HeaderCta href="/sign-up" label={tCommon('signUp')} source="header" />
            <div className="md:hidden">
              <MobileMenu />
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1" tabIndex={-1}>
        <LandingHero />
        <LandingManifesto />
        <LandingFeaturesGrid />
        <LandingChannels />
        <LandingCinematicInvitation />
        <LandingPricingCards defaultCurrency={defaultCurrency} />
        <LandingFaqAccordion />
        <LandingCtaFinal />
      </main>

      <LandingFooterRich />
    </LenisProvider>
  );
}
