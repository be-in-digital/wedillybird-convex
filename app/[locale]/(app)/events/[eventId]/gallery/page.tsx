import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowLeft, Lock, Clock } from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { AppShell } from '@/components/app/app-shell';
import { OwnerGallery } from '@/components/gallery/owner-gallery';
import { buttonVariants } from '@/components/ui/button';
import { canDownloadGalleryZip } from '@/lib/gallery/zip-access';
import { galleryAccessFor, galleryGraceDaysLeft } from '@/lib/payments/entitlements';
import { cn } from '@/lib/cn';

export default async function GalleryPage({
  params,
}: {
  params: Promise<{ locale: string; eventId: string }>;
}) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) {
    redirect({ href: '/sign-in', locale });
  }

  const convex = getConvexServerClient();
  const event = await convex.query(convexApi.getEventById, {
    eventId,
    requesterId: session!.userId,
  });
  if (!event) notFound();

  const user = await convex.query(convexApi.currentUser, { userId: session!.userId });
  const t = await getTranslations('Gallery');

  // Verrou côté UI : la mutation Convex `confirmOwnerUpload` jette
  // GALLERY_NOT_PURCHASED si `galleryExpiresAt` est undefined, et
  // GALLERY_EXPIRED si dépassé. On évite que l'utilisateur clique sur
  // upload pour rien — on bloque dès cette page avec un état distinct.
  // Server Component : `Date.now()` est OK ici (rendu serveur, pas
  // ré-évalué au runtime React). ESLint react-hooks/purity ne distingue
  // pas server vs client — on désactive juste pour cette ligne.
  // eslint-disable-next-line react-hooks/purity -- Server Component, no re-render concern
  const nowMs = Date.now();
  // Mariage d'agence : la galerie suit la couverture de l'organisation, pas une
  // date figée sur l'event — `galleryExpiresAt` n'y est jamais écrit.
  const org = event.organizationId
    ? await convex.query(convexApi.myOrganization, { userId: session!.userId })
    : null;
  const galleryStatus = galleryAccessFor(event, org, nowMs);
  const isOrgEvent = Boolean(event.organizationId);

  // Ne charge les photos que si la galerie est ouverte (la query côté
  // Convex est gardée par ownership, pas par expiry — on évite juste un
  // round-trip inutile).
  // `'grace'` charge les photos comme `'open'` : c'est tout l'objet du sursis.
  const photos =
    galleryStatus === 'open' || galleryStatus === 'grace'
      ? await convex.query(convexApi.listPhotosForOwner, {
          eventId,
          requesterId: session!.userId,
        })
      : [];

  return (
    <AppShell userName={user?.fullName}>
      <div className="container-page flex flex-col gap-8 py-12 sm:py-16">
        <header className="flex flex-col gap-3">
          <Link
            href={`/events/${eventId}`}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase transition-colors hover:text-[color:var(--color-ink-900)]"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} aria-hidden />
            {t('backToEvent')}
          </Link>
          <h1
            className="font-display text-balance italic"
            style={{
              fontSize: 'clamp(2rem, 4.5vw, 3rem)',
              lineHeight: 1.05,
              letterSpacing: '-0.022em',
              color: 'var(--color-ink-900)',
            }}
          >
            {t('title')}
          </h1>
          <p className="text-base leading-relaxed text-[color:var(--color-ink-500)] sm:text-lg">
            {t('subtitleOwner')}
          </p>
        </header>

        {galleryStatus === 'locked' ? (
          <GalleryGate
            Icon={Lock}
            title={t('lockedTitle')}
            hint={t('lockedHint')}
            cta={t('lockedCta')}
            href={`/events/${eventId}#upgrade` as never}
          />
        ) : galleryStatus === 'expired' ? (
          <GalleryGate
            Icon={Clock}
            // Une agence n'a pas d'upsell post-mariage à activer : elle a un
            // abonnement à reprendre, et la facturation est ailleurs.
            title={isOrgEvent ? t('orgExpiredTitle') : t('expiredTitle')}
            hint={isOrgEvent ? t('orgExpiredHint') : t('expiredHint')}
            cta={isOrgEvent ? t('orgExpiredCta') : t('expiredCta')}
            href={(isOrgEvent ? '/pro/billing' : `/events/${eventId}#upgrade`) as never}
          />
        ) : (
          <>
            {/* Le sursis doit se dire : une galerie qui se referme sans avoir
                prévenu, c'est le même problème repoussé de deux mois. */}
            {galleryStatus === 'grace' ? (
              <p
                role="status"
                className="rounded-xl border border-[color:var(--color-gold-700)] bg-[color:var(--color-ivory-100)] px-4 py-3 text-sm leading-relaxed text-[color:var(--color-ink-700)]"
              >
                {t('graceNotice', { days: galleryGraceDaysLeft(org, nowMs) })}
              </p>
            ) : null}
            <OwnerGallery
              eventId={eventId}
              initialPhotos={photos}
              canDownloadZip={canDownloadGalleryZip(event)}
              faceSearchEnabled={event.faceSearchEnabled === true}
              readOnly={galleryStatus === 'grace'}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

function GalleryGate({
  Icon,
  title,
  hint,
  cta,
  href,
}: {
  Icon: typeof Lock;
  title: string;
  hint: string;
  cta: string;
  href: string;
}) {
  return (
    <section className="flex flex-col items-center gap-6 rounded-3xl border border-dashed border-[color:var(--color-border-strong)] bg-white/60 px-8 py-16 text-center">
      <span
        aria-hidden
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{
          background: 'linear-gradient(135deg, oklch(95% 0.025 78) 0%, oklch(91% 0.05 78) 100%)',
          color: 'var(--color-gold-700)',
        }}
      >
        <Icon className="h-7 w-7" strokeWidth={1.5} />
      </span>
      <div className="flex max-w-md flex-col gap-3">
        <h2
          className="font-display italic"
          style={{
            fontSize: 'clamp(1.5rem, 2.4vw, 2rem)',
            lineHeight: 1.15,
            letterSpacing: '-0.018em',
            color: 'var(--color-ink-900)',
          }}
        >
          {title}
        </h2>
        <p className="text-sm leading-relaxed text-[color:var(--color-ink-500)] sm:text-base">
          {hint}
        </p>
      </div>
      <Link href={href} className={cn(buttonVariants({ variant: 'primary', size: 'lg' }))}>
        {cta}
      </Link>
    </section>
  );
}
