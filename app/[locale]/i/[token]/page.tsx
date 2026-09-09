import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { InvitationShell } from '@/components/invitation/invitation-shell';
import { InvitationContent } from '@/components/invitation/invitation-content';
import { TrackOnMount } from '@/components/analytics/track-on-mount';

// T2-5 : cache court plutôt que `force-dynamic` (qui retapait Convex à chaque
// vue — coûteux sous pic viral, F6 audit archi 2026-07-19). 30 s reste
// imperceptible pour un invité, et l'invalidation ciblée au submit RSVP
// (`revalidatePath('/i/${token}')`, cf. `actions.ts`) garde le statut RSVP à
// jour immédiatement sans attendre l'expiration du cache.
export const revalidate = 30;

/**
 * Metadata invitation personnelle — `noindex` strict.
 *
 * Une page invitation est nominative (token unique par invité) et ne doit
 * jamais apparaître en SERP : robots `index: false, follow: false` + pas
 * de canonical (la page n'a pas vocation à être la version "canonique" de
 * quoi que ce soit).
 */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

/**
 * Page invitation publique V4 — l'épée signature de Wedillybird.
 *
 * Architecture :
 *  - Server component : lit Convex (token → guest + event), injecte la couleur
 *    d'accent du couple en CSS custom property `--invitation-accent`
 *  - InvitationShell (client) : orchestre la cinématique d'ouverture auto-play
 *  - InvitationContent (partagé) : header couple + countdown + détails + RSVP +
 *    galerie, entièrement localisé (même corps que la version marque blanche)
 *
 * Personnalisation theme : si event.theme.primaryColor est défini, on l'utilise
 * comme accent (sceau, filets, bordures actives du RSVP). Fallback blush sinon.
 */
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const convex = getConvexServerClient();
  const data = await convex.query(convexApi.getGuestByToken, { token });
  if (!data) notFound();

  const { guest, event } = data;

  // Couleur d'accent — theme.primaryColor du couple si défini, sinon le
  // blush V4 par défaut. Injectée comme CSS custom prop `--invitation-accent`.
  const accentColor = event.theme?.primaryColor ?? 'oklch(72% 0.09 20)';

  // Formatage compact pour la cinématique (DD MMM YYYY en mono caps).
  const eventDateCompact = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: event.timezone,
  })
    .format(new Date(event.eventDate))
    .toUpperCase();

  const themeStyle = {
    '--invitation-accent': accentColor,
  } as CSSProperties;

  return (
    <main
      className="paper-grain relative flex min-h-screen flex-col bg-[color:var(--color-ivory-50)]"
      style={themeStyle}
    >
      {/* Vue invitation publique (haut de la boucle virale) — hors marque blanche. */}
      <TrackOnMount event="invitation_viewed" properties={{ white_label: false }} />
      <InvitationShell
        token={token}
        partnerA={event.coupleNames.partnerA}
        partnerB={event.coupleNames.partnerB}
        formattedDate={eventDateCompact}
        venueName={event.venue?.name}
        accentColor={accentColor}
      >
        <InvitationContent
          token={token}
          locale={locale}
          accentColor={accentColor}
          showFooter
          seatPassAvailable={event.seatingPublished}
          guest={guest}
          event={event}
        />
      </InvitationShell>
    </main>
  );
}
