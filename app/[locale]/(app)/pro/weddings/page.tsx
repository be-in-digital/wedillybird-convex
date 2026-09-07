import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Calendar, Users, ArrowUpRight, MapPin } from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { NewWeddingLauncher } from '@/components/pro/weddings/new-wedding-launcher';
import { PlanRequiredBanner } from '@/components/pro/plan-required-banner';
import { effectiveProTier, orgHasActiveAccess } from '@/lib/payments/entitlements';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ProPages');
  return { title: t('weddingsMetaTitle') };
}

type EventStatus = 'draft' | 'active' | 'archived' | 'cancelled';

const STATUS_STYLE: Record<EventStatus, { bg: string; fg: string; dot: string }> = {
  draft: {
    bg: 'oklch(28% 0.022 78)',
    fg: 'oklch(85% 0.04 78)',
    dot: 'oklch(78% 0.075 78)',
  },
  active: {
    bg: 'oklch(26% 0.04 145)',
    fg: 'oklch(82% 0.07 145)',
    dot: 'oklch(72% 0.08 145)',
  },
  archived: {
    bg: 'oklch(28% 0.012 78)',
    fg: 'oklch(72% 0.018 65)',
    dot: 'oklch(72% 0.018 65)',
  },
  cancelled: {
    bg: 'oklch(28% 0.04 25)',
    fg: 'oklch(82% 0.07 22)',
    dot: 'oklch(72% 0.09 20)',
  },
};

const STATUS_LABEL_KEY: Record<EventStatus, string> = {
  draft: 'weddingsStatusDraft',
  active: 'weddingsStatusActive',
  archived: 'weddingsStatusArchived',
  cancelled: 'weddingsStatusCancelled',
};

/**
 * Mariages — liste des events de l'organisation (back-office pro).
 *
 * Reprend l'ancienne grille du dashboard, déplacée ici depuis que
 * `/pro/dashboard` est devenu le cockpit.
 */
export default async function ProWeddingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('ProPages');

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const org = await convex.query(convexApi.myOrganization, { userId: session!.userId });
  if (!org) redirect({ href: '/pro/onboarding', locale });

  const [events, user] = await Promise.all([
    convex.query(convexApi.listOrgEvents, {
      organizationId: org!._id,
      requesterId: session!.userId,
    }),
    convex.query(convexApi.currentUser, { userId: session!.userId }),
  ]);
  const activeCount = events.filter((e) => e.status === 'active').length;
  const hasAccess = orgHasActiveAccess(org!);

  return (
    <ProSidebarShell
      current="weddings"
      org={{
        name: org!.name,
        primaryColor: org!.primaryColor,
        tier: effectiveProTier(org!),
        role: org!.myRole,
      }}
      user={{ name: user?.fullName }}
      eventsUsed={activeCount}
    >
      <div className="container-page flex flex-col gap-8 py-8 sm:py-10">
        {!hasAccess ? <PlanRequiredBanner feature="la création de mariages" /> : null}
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-muted-foreground)] uppercase">
              {t('weddingsCount', { count: events.length })}
            </span>
            <h1
              className="font-display italic"
              style={{
                fontSize: 'clamp(1.9rem, 4vw, 2.75rem)',
                lineHeight: 1.05,
                letterSpacing: '-0.022em',
                color: 'var(--color-foreground)',
              }}
            >
              {t('weddingsTitle')}
            </h1>
          </div>
          <NewWeddingLauncher autoOpen={sp.new === '1'} canCreate={hasAccess} />
        </header>

        {events.length === 0 ? (
          <div className="flex flex-col items-center gap-6 rounded-3xl border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]/40 px-8 py-16 text-center">
            <span
              aria-hidden
              className="flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--color-surface-elevated)] text-[color:var(--color-blush-300)]"
            >
              <Calendar className="h-6 w-6" strokeWidth={1.5} aria-hidden />
            </span>
            <p className="max-w-md text-sm leading-relaxed text-[color:var(--color-muted-foreground)] sm:text-base">
              {t('weddingsEmpty')}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {events.map((ev) => {
              const cfg = STATUS_STYLE[ev.status];
              const statusLabel = t(STATUS_LABEL_KEY[ev.status]);
              const dateFormatted = new Intl.DateTimeFormat(locale, {
                dateStyle: 'long',
                timeZone: ev.timezone ?? 'UTC',
              }).format(new Date(ev.eventDate));
              return (
                <li key={ev._id}>
                  <Link
                    href={`/pro/weddings/${ev._id}` as never}
                    className="focus-ring group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 transition-[transform,box-shadow,border-color] duration-300 [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:border-[color:var(--color-border-strong)] [@media(hover:hover)]:hover:shadow-[var(--shadow-lifted)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3
                        className="font-display italic"
                        style={{
                          fontSize: 'clamp(1.125rem, 1.6vw, 1.375rem)',
                          lineHeight: 1.15,
                          letterSpacing: '-0.018em',
                          color: 'var(--color-foreground)',
                        }}
                      >
                        {ev.coupleNames.partnerA}{' '}
                        <span style={{ color: 'var(--color-gold-500)' }}>&amp;</span>{' '}
                        {ev.coupleNames.partnerB}
                      </h3>
                      <span
                        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9px] tracking-[0.18em] uppercase"
                        style={{ background: cfg.bg, color: cfg.fg }}
                      >
                        <span
                          aria-hidden
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: cfg.dot }}
                        />
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-sm text-[color:var(--color-muted-foreground)]">{ev.title}</p>
                    <div className="flex flex-col gap-2 border-t border-[color:var(--color-border)] pt-4">
                      <p className="flex items-start gap-2.5 text-sm text-[color:var(--color-foreground)]">
                        <Calendar
                          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[color:var(--color-blush-300)]"
                          strokeWidth={2}
                          aria-hidden
                        />
                        {dateFormatted}
                      </p>
                      {ev.venue ? (
                        <p className="flex items-start gap-2.5 text-sm text-[color:var(--color-muted-foreground)]">
                          <MapPin
                            className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[color:var(--color-blush-300)]"
                            strokeWidth={2}
                            aria-hidden
                          />
                          {ev.venue}
                        </p>
                      ) : null}
                      <p className="flex items-start gap-2.5 text-sm text-[color:var(--color-muted-foreground)]">
                        <Users
                          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[color:var(--color-blush-300)]"
                          strokeWidth={2}
                          aria-hidden
                        />
                        {t('weddingsMaxInvitations', { count: ev.maxGuests })}
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className="absolute top-5 right-5 flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--color-surface-elevated)] text-[color:var(--color-blush-300)] opacity-0 transition-opacity duration-300 [@media(hover:hover)]:group-hover:opacity-100"
                    >
                      <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ProSidebarShell>
  );
}
