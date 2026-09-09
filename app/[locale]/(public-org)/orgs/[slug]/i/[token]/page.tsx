import type { CSSProperties } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { InvitationShell } from '@/components/invitation/invitation-shell';
import { InvitationContent } from '@/components/invitation/invitation-content';
import { TrackOnMount } from '@/components/analytics/track-on-mount';

export const dynamic = 'force-dynamic';

/**
 * Page invitation guest sous le sous-domaine de l'orga :
 * `<orgSlug>.wedillybird.com/i/<token>`. Strictement la même lecture du guest
 * que `app/[locale]/i/[token]/page.tsx`, rendue dans le wrapper `(public-org)`
 * qui applique le branding orga.
 *
 * Le token reste globalement unique (pas scopé à l'orga) — un invité d'une
 * autre orga arrivant ici verra son invitation, simplement encadrée du branding
 * orga courant. C'est volontaire : le sous-domaine est une vitrine, le token
 * reste universel. Le corps de page est mutualisé (`InvitationContent`), donc
 * entièrement localisé — le footer marque Wedillybird est masqué (marque blanche).
 */
export default async function PublicOrgInvitationPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const convex = getConvexServerClient();
  const data = await convex.query(convexApi.getGuestByToken, { token });
  if (!data) notFound();

  const { guest, event } = data;

  const accentColor = event.theme?.primaryColor ?? 'var(--brand-primary, oklch(72% 0.09 20))';

  const eventDateCompact = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: event.timezone,
  })
    .format(new Date(event.eventDate))
    .toUpperCase();

  const themeStyle = { '--invitation-accent': accentColor } as CSSProperties;

  return (
    <main
      className="paper-grain relative flex min-h-screen flex-col bg-[color:var(--color-ivory-50)]"
      style={themeStyle}
    >
      {/* Vue invitation publique sous marque blanche (sous-domaine orga). */}
      <TrackOnMount event="invitation_viewed" properties={{ white_label: true }} />
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
          seatPassAvailable={event.seatingPublished}
          guest={guest}
          event={event}
        />
      </InvitationShell>
    </main>
  );
}
