import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeft, RotateCcw, Sparkles } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { OG_DEFAULT_IMAGES, TWITTER_DEFAULT_IMAGES } from '@/lib/seo/og';
import { toOgLocale } from '@/lib/i18n/locale-tags';
import { SAMPLE_EVENT_DATE_ISO } from '@/lib/invitation/sample-date';
import { isCinematicId, DEFAULT_CINEMATIC } from '@/components/invitation/cinematics/registry';
import { InvitationShell } from '@/components/invitation/invitation-shell';
import { InvitationContent } from '@/components/invitation/invitation-content';
import { HeaderCta } from '@/components/landing/header-cta';

/**
 * Démo publique de l'invitation — `/demo`.
 *
 * C'est la preuve produit demandée par l'audit de sept. 2026 : jusque-là le
 * « WoW » (enveloppe qui s'ouvre, sceau qui se brise) n'était que décrit sur la
 * landing, et le lien « Démo en direct » du footer menait à l'inscription.
 *
 * Rend EXACTEMENT la page qu'un invité reçoit (`/i/[token]`) — même shell,
 * même cinématique, même formulaire RSVP — avec un couple fictif et :
 *  - aucune lecture ni écriture Convex : données statiques ci-dessous,
 *    RSVP en mode `demo` (accepté localement, event `demo_rsvp_submitted`) ;
 *  - un bandeau fixe qui dit que c'est une démo et propose de créer la sienne ;
 *  - `?cinematic=<id>` pour montrer un autre univers, `?replay=1` pour rejouer
 *    l'ouverture (le shell mémorise en sessionStorage qu'elle a été vue).
 *
 * Indexable (contrairement aux vraies invitations, `noindex`) : c'est une page
 * marketing. Aucun cookie ni consentement requis pour la voir.
 */

/** Couple fictif — prénoms volontairement courts et lisibles dans 7 langues. */
const DEMO = {
  token: 'demo',
  partnerA: 'Léa',
  partnerB: 'Adam',
  timezone: 'Europe/Paris',
  accentColor: 'oklch(72% 0.09 20)',
  plusOnesAllowed: 1,
} as const;

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Demo' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: '/demo' },
    openGraph: {
      type: 'website',
      url: `${BASE_URL}/demo`,
      siteName: 'Wedillybird',
      title: t('metaTitle'),
      description: t('metaDescription'),
      locale: toOgLocale(locale),
      images: [...OG_DEFAULT_IMAGES],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('metaTitle'),
      description: t('metaDescription'),
      images: [...TWITTER_DEFAULT_IMAGES],
    },
  };
}

export default async function DemoInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ cinematic?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { cinematic: requested } = await searchParams;
  const cinematic = isCinematicId(requested) ? requested : DEFAULT_CINEMATIC;

  const t = await getTranslations('Demo');
  const tCommon = await getTranslations('Common');

  const eventDate = new Date(SAMPLE_EVENT_DATE_ISO).getTime();
  const eventDateCompact = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: DEMO.timezone,
  })
    .format(eventDate)
    .toUpperCase();

  const themeStyle = { '--invitation-accent': DEMO.accentColor } as CSSProperties;

  return (
    <main
      className="paper-grain relative flex min-h-screen flex-col bg-[color:var(--color-ivory-50)]"
      style={themeStyle}
    >
      {/* Bandeau démo — fixed top, au-dessus de la cinématique (z-50) pour que
          le visiteur puisse toujours revenir au site ou créer la sienne. */}
      <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-between gap-3 border-b border-[color:var(--color-border)] bg-[color:var(--color-ink-900)] px-4 py-2 text-white shadow-md sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="focus-ring inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.24em] text-white/80 uppercase transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">{t('back')}</span>
          </Link>
          <span className="inline-flex min-w-0 items-center gap-2 font-mono text-[10px] tracking-[0.24em] uppercase">
            <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            <span className="truncate">{t('banner')}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <a
            href="?replay=1"
            className="focus-ring hidden items-center gap-1.5 font-mono text-[10px] tracking-[0.24em] text-white/80 uppercase transition-colors hover:text-white md:inline-flex"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={2} aria-hidden />
            {t('replay')}
          </a>
          <HeaderCta
            href="/sign-up"
            label={t('cta')}
            source="demo_banner"
            className="h-8 bg-white text-[color:var(--color-ink-900)] hover:bg-[color:var(--color-ivory-100)] md:h-8"
          />
        </div>
      </div>

      {/* Padding-top pour que le bandeau ne couvre pas la cinématique */}
      <div className="pt-11">
        <InvitationShell
          token={DEMO.token}
          partnerA={DEMO.partnerA}
          partnerB={DEMO.partnerB}
          formattedDate={eventDateCompact}
          venueName={t('venueName')}
          accentColor={DEMO.accentColor}
          eventDate={eventDate}
          cinematic={cinematic}
          music={null}
        >
          <InvitationContent
            token={DEMO.token}
            locale={locale}
            accentColor={DEMO.accentColor}
            showFooter
            demo
            guest={{
              fullName: t('guestName'),
              plusOnesAllowed: DEMO.plusOnesAllowed,
              rsvpStatus: 'pending',
            }}
            event={{
              coupleNames: { partnerA: DEMO.partnerA, partnerB: DEMO.partnerB },
              eventDate,
              timezone: DEMO.timezone,
              venue: { name: t('venueName'), address: t('venueAddress') },
              rsvpConfig: null,
            }}
          />
        </InvitationShell>
      </div>

      {/* Rappel discret sous la démo : on est bien sur Wedillybird. */}
      <p className="sr-only">{tCommon('appName')}</p>
    </main>
  );
}
