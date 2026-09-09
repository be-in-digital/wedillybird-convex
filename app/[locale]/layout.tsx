import type { Metadata } from 'next';
import { Bodoni_Moda, Geist, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isRtlLocale, routing, type Locale } from '@/i18n/routing';
import { toOgLocale } from '@/lib/i18n/locale-tags';
import { ConvexClientProvider } from '@/components/providers/convex-client-provider';
import { SkipLink } from '@/components/layout/skip-link';
import { Toaster } from '@/components/ui/toast';
import { CookieConsent } from '@/components/layout/cookie-consent';
import { MetaPixel } from '@/components/analytics/meta-pixel';
import { LocaleSuggestionBanner } from '@/components/layout/locale-suggestion-banner';
import { Analytics } from '@vercel/analytics/next';
import '../globals.css';

// Body / UI — Geist Sans (Vercel, OFL). Successeur d'Inter recommandé en 2025+.
const geistSans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

// Mono — Geist Mono pour QR tokens, IDs, timestamps, IBAN factures.
const geistMono = Geist_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
});

// Display — Bodoni Moda Italic (Google Fonts, OFL).
// Didone moderne variable, signature éditoriale "magazine de mode" italienne.
// Sortie de Fraunces (sur-utilisée par tous les SaaS premium 2024-2026) pour
// une typographie plus rare, plus tranchante, plus haute en contraste —
// l'ADN visuel de Vogue Italia, Atelier Isabey, des éditoriaux luxe.
//
// Variable axes : weight 400-900 + optical sizing automatique.
// Fallback Iowan Old Style Italic / Georgia gérés dans globals.css.
const bodoniModa = Bodoni_Moda({
  variable: '--font-display',
  weight: ['400', '500', '600'],
  style: ['italic'],
  subsets: ['latin'],
  display: 'swap',
});

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Metadata.landing' });
  return {
    title: {
      default: t('title'),
      template: '%s · Wedillybird',
    },
    description: t('description'),
    metadataBase: new URL(BASE_URL),
    openGraph: {
      locale: toOgLocale(locale),
      type: 'website',
      siteName: 'Wedillybird',
    },
    appleWebApp: {
      title: 'Wedillybird',
      capable: true,
      statusBarStyle: 'default',
    },
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, l === routing.defaultLocale ? '/' : `/${l}`]),
      ),
    },
  };
}

export const viewport = {
  // Ivoire chaud (token --color-ivory-50). Cohérent avec la palette mariage
  // claire — la barre de status mobile se fond avec le fond du site.
  themeColor: '#fbf6ee',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * JSON-LD Organization injecté en `<body>` — schema.org pour permettre à
 * Google de présenter Wedillybird comme entité (knowledge panel, sitelinks).
 * `description` est traduite (Common.meta.organizationDescription) ; les autres
 * champs (nom de marque, URLs) ne sont pas localisés.
 */
function organizationJsonLd(description: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Wedillybird',
    url: BASE_URL,
    logo: `${BASE_URL}/wedillybird-logo.png`,
    description,
    sameAs: [],
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const dir = isRtlLocale(locale as Locale) ? 'rtl' : 'ltr';

  const tMeta = await getTranslations({ locale, namespace: 'Common.meta' });
  const organizationLd = organizationJsonLd(tMeta('organizationDescription'));

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${geistSans.variable} ${geistMono.variable} ${bodoniModa.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
        />
        <NextIntlClientProvider>
          <ConvexClientProvider convexUrl={process.env.NEXT_PUBLIC_CONVEX_URL}>
            <SkipLink />
            <LocaleSuggestionBanner currentLocale={locale as Locale} />
            {children}
            <Toaster />
            <CookieConsent />
            <MetaPixel />
          </ConvexClientProvider>
        </NextIntlClientProvider>
        {/* Vercel Web Analytics — mesure d'audience SANS cookie ni identifiant
            persistant (hash quotidien), donc hors du périmètre du consentement
            (exemption CNIL « mesure d'audience »). C'est la vérité terrain sur
            les volumes : PostHog, lui, ne voit que les visiteurs qui acceptent
            la bannière. Script servi en same-origin (/_vercel/insights), déjà
            couvert par la CSP `'self'`. Inerte tant que Web Analytics n'est pas
            activé sur le projet Vercel. */}
        <Analytics />
      </body>
    </html>
  );
}
