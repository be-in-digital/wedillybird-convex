import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Camera,
  MessageCircle,
  QrCode,
  Users,
  Eye,
  Sparkles,
  Archive,
  Settings,
  Armchair,
} from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { Button, buttonVariants } from '@/components/ui/button';
import { AppShell } from '@/components/app/app-shell';
import { BroadcastInvitationsCard } from '@/components/events/broadcast-invitations-card';
import { LiveGuestStats } from '@/components/events/live-guest-stats';
import { NotificationsPanel } from '@/components/notifications/notifications-panel';
import { UpgradeCard } from '@/components/payments/upgrade-card';
import { PostEventUpsellCard } from '@/components/payments/post-event-upsell-card';
import { routePayment } from '@/lib/payments/country';
import { eventNeedsConsumerPlan } from '@/lib/payments/entitlements';
import { togglePublishAction } from '@/app/[locale]/(app)/events/actions';
import { cn } from '@/lib/cn';

type EventStatus = 'draft' | 'active' | 'archived' | 'cancelled';

const STATUS_CONFIG: Record<
  EventStatus,
  { labelKey: string; bg: string; fg: string; dot: string }
> = {
  draft: {
    labelKey: 'draftBadge',
    bg: 'oklch(94% 0.022 78)',
    fg: 'var(--color-ink-700)',
    dot: 'oklch(78% 0.075 78)',
  },
  active: {
    labelKey: 'activeBadge',
    bg: 'oklch(96% 0.018 145)',
    fg: 'oklch(50% 0.08 145)',
    dot: 'oklch(50% 0.08 145)',
  },
  archived: {
    labelKey: 'archivedBadge',
    bg: 'oklch(94% 0.012 78)',
    fg: 'var(--color-ink-500)',
    dot: 'var(--color-ink-500)',
  },
  cancelled: {
    labelKey: 'cancelledBadge',
    bg: 'oklch(96% 0.025 25)',
    fg: 'var(--color-blush-700)',
    dot: 'var(--color-blush-700)',
  },
};

export default async function EventDetailPage({
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

  // Un couple rattaché à une agence (collaborateur, pas propriétaire) ne doit pas voir
  // cette page « propriétaire » B2C (upgrade, publication…) : on l'envoie sur son espace.
  if (event.ownerId !== session!.userId) {
    redirect({ href: `/espace-couple/${eventId}`, locale });
  }

  const counts = await convex.query(convexApi.countGuestsByEvent, {
    eventId,
    requesterId: session!.userId,
  });

  // Livraison SMS RÉELLE (délivrés / en attente / non délivrés) — remplace le
  // compteur trompeur « X envoyés » (F4). Rafraîchi au router.refresh() après un
  // broadcast, mis à jour par le webhook StatusCallback + le cron de secours.
  const delivery = await convex.query(convexApi.deliveryForEvent, {
    eventId,
    requesterId: session!.userId,
  });

  const user = await convex.query(convexApi.currentUser, { userId: session!.userId });
  // Commande de livre photo : seulement pertinente une fois l'upsell HD acheté.
  const photoBookOrder = event.hdUpsellPurchasedAt
    ? await convex.query(convexApi.getPhotoBookOrder, {
        eventId,
        requesterId: session!.userId,
      })
    : null;
  const t = await getTranslations('EventDetail');
  const tDash = await getTranslations('Dashboard');
  const statusCfg = STATUS_CONFIG[event.status];

  const dateFormatted = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: event.timezone,
  }).format(new Date(event.eventDate));

  const isDraft = event.status === 'draft';

  // Pour les events pro (rattachés à une organisation), le bouton Publier
  // dépend des crédits PAYG ou d'une subscription active de l'orga, pas du
  // `planTier` particulier (qui reste undefined). On précharge l'état pour
  // pouvoir afficher un message clair "achetez un crédit" plutôt que la
  // simple disable.
  const orgId = event.organizationId;
  let proPublishState:
    | { kind: 'particulier' }
    | { kind: 'pro_with_sub' }
    | { kind: 'pro_with_credits'; credits: number }
    | { kind: 'pro_at_quota'; quota: number }
    | { kind: 'pro_no_credits' } = { kind: 'particulier' };
  if (orgId) {
    const credits = await convex
      .query(convexApi.getPaygCreditsByOrganization, {
        organizationId: orgId,
        requesterId: session!.userId,
      })
      .catch(() => null);
    const orgRole = await convex
      .query(convexApi.myOrganization, { userId: session!.userId })
      .catch(() => null);
    const hasActiveSub =
      orgRole?.subscriptionStatus === 'active' || orgRole?.subscriptionStatus === 'trialing';
    if (hasActiveSub) {
      // Sub active : publication OK… sauf si l'orga a déjà atteint son quota
      // d'events actifs simultanés (Starter 5 / Business 20 / Agency 50). Dans
      // ce cas on désactive le bouton + hint clair plutôt que de laisser la
      // mutation throw EVENT_QUOTA_EXCEEDED en silence.
      const quotaStatus = await convex
        .query(convexApi.orgPublishQuotaStatus, {
          eventId,
          requesterId: session!.userId,
        })
        .catch(() => null);
      if (quotaStatus?.applicable && quotaStatus.atQuota) {
        proPublishState = { kind: 'pro_at_quota', quota: quotaStatus.quota };
      } else {
        proPublishState = { kind: 'pro_with_sub' };
      }
    } else if ((credits?.credits ?? 0) > 0) {
      proPublishState = { kind: 'pro_with_credits', credits: credits!.credits };
    } else {
      proPublishState = { kind: 'pro_no_credits' };
    }
  }

  // Indicateur d'abonnement. `planTier` est `undefined` tant qu'aucun paiement
  // n'a été enregistré (= aucune galerie ouverte). On distingue 4 états :
  // pas de plan / pending (forfait choisi mais pas payé) / Essentiel payé /
  // Premium payé. Un suffix "Rétention 5 ans" est ajouté si l'upsell post-
  // mariage a étendu `galleryExpiresAt` au-delà de la durée standard du tier.
  const planTier = event.planTier;
  const pendingPlanTier = event.pendingPlanTier;
  const isPaid = !!planTier;
  const planLabel = planTier
    ? planTier === 'premium'
      ? t('planPremium')
      : t('planEssential')
    : pendingPlanTier
      ? pendingPlanTier === 'premium'
        ? t('planPremiumPending')
        : t('planEssentialPending')
      : t('planNone');
  const STANDARD_RETENTION_MS: Record<'essential' | 'premium', number> = {
    essential: 30 * 24 * 60 * 60 * 1000,
    premium: 180 * 24 * 60 * 60 * 1000,
  };
  const hasUpsell =
    !!planTier &&
    typeof event.galleryExpiresAt === 'number' &&
    event.galleryExpiresAt - event.eventDate >
      STANDARD_RETENTION_MS[planTier] + 24 * 60 * 60 * 1000;

  const headerSection = (
    <div className="flex flex-col gap-5">
      {user?.role !== 'couple' ? (
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase transition-colors hover:text-[color:var(--color-ink-900)]"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} aria-hidden />
          {t('backToDashboard')}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1
            className="font-display text-balance italic"
            style={{
              fontSize: 'clamp(2rem, 4.5vw, 3rem)',
              lineHeight: 1.05,
              letterSpacing: '-0.022em',
              color: 'var(--color-ink-900)',
            }}
          >
            {event.coupleNames.partnerA}{' '}
            <span style={{ color: 'var(--color-gold-500)' }}>&amp;</span>{' '}
            {event.coupleNames.partnerB}
          </h1>
          <p className="text-sm text-[color:var(--color-ink-500)]">{event.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PlanBadge
            tier={planTier}
            // Event d'agence : le forfait n'est pas une décision de cet écran.
            coveredByOrganization={!eventNeedsConsumerPlan(event)}
            label={eventNeedsConsumerPlan(event) ? planLabel : t('planByOrganization')}
            upsellSuffix={hasUpsell ? t('planUpsellSuffix') : null}
            activateLabel={t('activatePlan')}
          />
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase"
            style={{ background: statusCfg.bg, color: statusCfg.fg }}
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: statusCfg.dot }}
            />
            {tDash(statusCfg.labelKey)}
          </span>
        </div>
      </div>
    </div>
  );

  const detailsSection = (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <DetailCard
        Icon={Calendar}
        label={t('dateSection')}
        primary={dateFormatted}
        secondary={event.timezone}
      />
      <DetailCard
        Icon={MapPin}
        label={t('venueSection')}
        primary={event.venue?.name ?? t('noVenue')}
        secondary={event.venue?.address}
      />
    </section>
  );

  const pilotSection = (
    <section className="flex flex-col gap-5 rounded-3xl border border-[color:var(--color-border)] bg-white p-7 shadow-[var(--shadow-soft)]">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-gold-700)] uppercase">
          {t('pilotEyebrow')}
        </span>
        <h2
          className="font-display italic"
          style={{
            fontSize: 'clamp(1.5rem, 2.4vw, 2rem)',
            lineHeight: 1.15,
            letterSpacing: '-0.018em',
            color: 'var(--color-ink-900)',
          }}
        >
          {t('pilotTitle')}
        </h2>
        {(() => {
          // Hint à afficher en haut de la section "Pilotez votre mariage".
          // - Pro avec sub OU credits → message standard `draftHint`
          // - Pro sans sub ni credits → message PAYG dédié
          // - Particulier payé → `draftHint`
          // - Particulier sans plan → `publishLockedHint`
          if (!isDraft) return null;
          if (proPublishState.kind === 'pro_no_credits') {
            return (
              <p className="text-sm leading-relaxed text-[color:var(--color-ink-500)] sm:text-base">
                {t('publishLockedHintPayg')}
              </p>
            );
          }
          if (proPublishState.kind === 'pro_at_quota') {
            return (
              <p className="text-sm leading-relaxed text-[color:var(--color-ink-500)] sm:text-base">
                {t('publishLockedHintQuota', { quota: proPublishState.quota })}
              </p>
            );
          }
          if (
            proPublishState.kind === 'pro_with_sub' ||
            proPublishState.kind === 'pro_with_credits' ||
            isPaid
          ) {
            return (
              <p className="text-sm leading-relaxed text-[color:var(--color-ink-500)] sm:text-base">
                {t('draftHint')}
              </p>
            );
          }
          return (
            <p className="text-sm leading-relaxed text-[color:var(--color-ink-500)] sm:text-base">
              {t('publishLockedHint')}
            </p>
          );
        })()}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
        <form action={togglePublishAction} className="w-full">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="action" value={isDraft ? 'publish' : 'unpublish'} />
          <Button
            type="submit"
            variant={isDraft ? 'primary' : 'outline'}
            size="md"
            className="w-full"
            disabled={
              isDraft &&
              !isPaid &&
              proPublishState.kind !== 'pro_with_sub' &&
              proPublishState.kind !== 'pro_with_credits'
            }
            title={
              isDraft && proPublishState.kind === 'pro_no_credits'
                ? t('publishLockedHintPayg')
                : isDraft && proPublishState.kind === 'pro_at_quota'
                  ? t('publishLockedHintQuota', { quota: proPublishState.quota })
                  : isDraft && !isPaid && proPublishState.kind === 'particulier'
                    ? t('publishLockedHint')
                    : undefined
            }
          >
            {isDraft ? (
              <>
                <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />
                {t('publish')}
              </>
            ) : (
              <>
                <Archive className="h-4 w-4" strokeWidth={2} aria-hidden />
                {t('unpublish')}
              </>
            )}
          </Button>
        </form>
        <Link
          href={`/events/${eventId}/preview` as never}
          className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'w-full')}
        >
          <Eye className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('previewInvitation')}
        </Link>
        <Link
          href={`/events/${eventId}/messaging` as never}
          className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'w-full')}
        >
          <MessageCircle className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('customizeMessage')}
        </Link>
        <Link
          href={`/events/${eventId}/edit` as never}
          className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'w-full')}
        >
          <Settings className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('editDetails')}
        </Link>
      </div>
    </section>
  );

  const guestsSection = (
    <section className="flex flex-col gap-5 rounded-3xl border border-[color:var(--color-border)] bg-white p-7 shadow-[var(--shadow-soft)]">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-blush-700)] uppercase">
          {t('guestsEyebrow')}
        </span>
        <h2
          className="font-display italic"
          style={{
            fontSize: 'clamp(1.5rem, 2.4vw, 2rem)',
            lineHeight: 1.15,
            letterSpacing: '-0.018em',
            color: 'var(--color-ink-900)',
          }}
        >
          {t('guestsTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-[color:var(--color-ink-500)] sm:text-base">
          {t('guestsSummary', {
            total: counts.total,
            attending: counts.attending,
            max: event.maxGuests,
          })}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <Link
          href={`/events/${eventId}/guests`}
          className={cn(buttonVariants({ variant: 'primary', size: 'md' }), 'flex-1')}
        >
          <Users className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('manageGuests')}
        </Link>
        <Link
          href={`/events/${eventId}/check-in`}
          className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'flex-1')}
        >
          <QrCode className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('openCheckIn')}
        </Link>
        <Link
          href={`/events/${eventId}/gallery`}
          className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'flex-1')}
        >
          <Camera className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('openGallery')}
        </Link>
        <Link
          href={`/events/${eventId}/seating`}
          className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'flex-1')}
        >
          <Armchair className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('openSeating')}
        </Link>
      </div>
    </section>
  );

  const broadcastSection = (
    <BroadcastInvitationsCard
      eventId={eventId}
      eventStatus={event.status}
      counts={{
        total: counts.total,
        invited: counts.invited,
        withPhone: counts.withPhone,
      }}
      delivery={{
        total: delivery.total,
        delivered: delivery.delivered,
        pending: delivery.queued + delivery.sent,
        undelivered: delivery.undelivered,
        failed: delivery.failed,
        undeliveredRate: delivery.undeliveredRate,
      }}
    />
  );

  const statsSection = (
    <LiveGuestStats
      eventId={eventId}
      requesterId={session!.userId}
      initialCounts={counts}
      maxGuests={event.maxGuests}
    />
  );

  // Un mariage porté par une agence est couvert par l'abonnement (ou le compte
  // offert) de l'organisation : lui proposer un forfait particulier ferait dire
  // à l'écran l'inverse de ce que fait `decidePublishGate`.
  const upgradeSection = !eventNeedsConsumerPlan(event) ? null : (
    <div id="upgrade" className="flex scroll-mt-24 flex-col gap-4">
      <UpgradeCard
        eventId={eventId}
        currentTier={event.planTier}
        currency={routePayment(undefined).currency}
      />
      {/* Upsell HD post-event : proposé uniquement sur un event déjà payé. */}
      {event.planTier ? (
        <PostEventUpsellCard
          eventId={eventId}
          currency={routePayment(undefined).currency}
          purchased={event.hdUpsellPurchasedAt !== undefined}
          photoBook={photoBookOrder ? { status: photoBookOrder.status } : null}
        />
      ) : null}
    </div>
  );

  return (
    <AppShell userName={user?.fullName}>
      <div className="container-page flex flex-col gap-12 py-12 sm:py-16">
        {/* Pour un compte particulier (couple) cette page EST le dashboard
            (redirect depuis /dashboard). L'agencement des sections est
            piloté par le statut de l'event :
            - draft : on remonte les actions de publication (Pilotez) et
              l'onboarding des invités, puis broadcast (disabled), stats
              (vides), upgrade en bas.
            - active/archived/cancelled : on remonte le pouls de l'event
              (stats live, broadcast quotidien) et les actions invités. */}
        {headerSection}
        {detailsSection}
        <NotificationsPanel userId={session!.userId} />
        {isDraft ? (
          <>
            {pilotSection}
            {guestsSection}
            {broadcastSection}
            {statsSection}
            {upgradeSection}
          </>
        ) : (
          <>
            {statsSection}
            {broadcastSection}
            {guestsSection}
            {pilotSection}
            {upgradeSection}
          </>
        )}
      </div>
    </AppShell>
  );
}

function DetailCard({
  Icon,
  label,
  primary,
  secondary,
}: {
  Icon: typeof Calendar;
  label: string;
  primary: string;
  secondary?: string;
}) {
  return (
    <article className="flex items-start gap-4 rounded-3xl border border-[color:var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft)]">
      <span
        aria-hidden
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
        style={{
          background: 'oklch(95% 0.025 22)',
          color: 'var(--color-blush-700)',
        }}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase">
          {label}
        </span>
        <p className="text-base font-medium text-[color:var(--color-ink-900)]">{primary}</p>
        {secondary ? (
          <p className="text-sm text-[color:var(--color-ink-500)]">{secondary}</p>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Indicateur d'abonnement à côté du badge de statut. Sans plan, sert aussi
 * de point d'entrée vers la section UpgradeCard plus bas dans la page (ancre
 * `#upgrade`). Avec plan, affiche le tier et un suffix optionnel si l'upsell
 * post-mariage a été activé.
 *
 * `coveredByOrganization` coupe le lien : sur un mariage d'agence, la section
 * `#upgrade` n'existe pas et il n'y a pas de forfait à activer. Le badge ne
 * doit pas non plus rester muet — « Aucun forfait » laisserait croire qu'il
 * manque quelque chose à payer.
 */
function PlanBadge({
  tier,
  label,
  upsellSuffix,
  activateLabel,
  coveredByOrganization = false,
}: {
  tier: 'essential' | 'premium' | undefined;
  label: string;
  upsellSuffix: string | null;
  activateLabel: string;
  coveredByOrganization?: boolean;
}) {
  const colors = tier
    ? {
        bg: 'oklch(95% 0.04 78)',
        fg: 'var(--color-gold-700)',
        dot: 'var(--color-gold-500)',
      }
    : {
        bg: 'oklch(96% 0.012 78)',
        fg: 'var(--color-ink-500)',
        dot: 'var(--color-ink-300)',
      };

  const content = (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase"
      style={{ background: colors.bg, color: colors.fg }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: colors.dot }}
      />
      {label}
      {upsellSuffix ? <span className="font-sans normal-case">{upsellSuffix}</span> : null}
    </span>
  );

  if (!tier && !coveredByOrganization) {
    return (
      <a
        href="#upgrade"
        aria-label={activateLabel}
        className="focus-ring rounded-full transition-opacity hover:opacity-80"
      >
        {content}
      </a>
    );
  }
  return content;
}
