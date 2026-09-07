import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListChecks } from 'lucide-react';
import { requireProContext } from '@/lib/pro/require-pro-context';
import { nowMs } from '@/lib/pro/format';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { PlanningBoard } from '@/components/pro/planning/planning-board';
import { PlanRequiredBanner } from '@/components/pro/plan-required-banner';
import { effectiveProTier, orgHasActiveAccess } from '@/lib/payments/entitlements';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ProPages');
  return { title: t('planningMetaTitle') };
}

export default async function ProPlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { session, org, user } = await requireProContext(locale);
  const t = await getTranslations('ProPages');
  const shellOrg = {
    name: org.name,
    primaryColor: org.primaryColor,
    tier: effectiveProTier(org),
    role: org.myRole,
  };
  const hasAccess = orgHasActiveAccess(org);

  const convex = getConvexServerClient();
  const events = await convex.query(convexApi.listOrgEvents, {
    organizationId: org._id,
    requesterId: session.userId,
  });

  if (events.length === 0) {
    return (
      <ProSidebarShell current="planning" org={shellOrg} user={{ name: user?.fullName }}>
        <div className="container-page flex flex-col gap-6 py-8 sm:py-10">
          <header className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--color-surface-elevated)] text-[color:var(--color-blush-300)]"
            >
              <ListChecks className="h-5 w-5" strokeWidth={1.7} />
            </span>
            <h1
              className="font-display italic"
              style={{
                fontSize: 'clamp(1.9rem, 4vw, 2.75rem)',
                letterSpacing: '-0.022em',
                color: 'var(--color-foreground)',
              }}
            >
              {t('planningTitle')}
            </h1>
          </header>
          {!hasAccess ? <PlanRequiredBanner feature="le rétroplanning" /> : null}
          <div className="rounded-3xl border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]/40 px-8 py-16 text-center text-sm text-[color:var(--color-muted-foreground)]">
            {t('planningEmpty')}
          </div>
        </div>
      </ProSidebarShell>
    );
  }

  const selectedId = sp.event && events.some((e) => e._id === sp.event) ? sp.event : events[0]!._id;
  const planning = await convex.query(convexApi.planningListByEvent, {
    eventId: selectedId,
    requesterId: session.userId,
  });
  const eventOptions = events.map((e) => ({
    _id: e._id,
    label: `${e.coupleNames.partnerA}${e.coupleNames.partnerB ? ` & ${e.coupleNames.partnerB}` : ''}`,
    partnerA: e.coupleNames.partnerA,
    partnerB: e.coupleNames.partnerB,
    eventDate: e.eventDate,
    timezone: e.timezone,
    venue: e.venue,
    status: e.status,
  }));
  const [rawMembers, customTemplates] = await Promise.all([
    convex.query(convexApi.listOrgMembers, {
      organizationId: org._id,
      requesterId: session.userId,
    }),
    convex.query(convexApi.planningListTemplates, {
      organizationId: org._id,
      requesterId: session.userId,
    }),
  ]);
  const members = rawMembers
    .filter((m) => m.status === 'active' && m.userId)
    .map((m) => ({
      userId: m.userId as string,
      name: m.fullName ?? m.email ?? t('memberFallback'),
    }));

  return (
    <ProSidebarShell current="planning" org={shellOrg} user={{ name: user?.fullName }}>
      {!hasAccess ? (
        <div className="container-page pt-8">
          <PlanRequiredBanner feature="le rétroplanning" />
        </div>
      ) : null}
      <PlanningBoard
        events={eventOptions}
        selectedEventId={selectedId}
        orgName={org.name}
        tasks={planning?.tasks ?? []}
        canWrite={org.myRole !== 'viewer'}
        now={nowMs()}
        eventDate={planning?.eventDate ?? null}
        members={members}
        customTemplates={customTemplates}
      />
    </ProSidebarShell>
  );
}
