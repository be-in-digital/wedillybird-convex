import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { requireProContext } from '@/lib/pro/require-pro-context';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { RsvpQuestionsEditor } from '@/components/events/rsvp-questions-editor';
import { effectiveProTier, eventHasPremiumOnlyFeature } from '@/lib/payments/entitlements';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ProPages');
  return { title: t('weddingHubMetaTitle') };
}

/**
 * Édition des questions RSVP côté back-office agence (thème dark). Rend le même
 * `RsvpQuestionsEditor` que le parcours couple — il est theme-portable (tokens
 * sémantiques). Réservé aux mariages de l'organisation courante.
 */
export default async function ProWeddingRsvpPage({
  params,
}: {
  params: Promise<{ locale: string; eventId: string }>;
}) {
  const { locale, eventId } = await params;
  setRequestLocale(locale);
  const { session, org, user } = await requireProContext(locale);
  const convex = getConvexServerClient();

  const [event, orgEvents] = await Promise.all([
    convex.query(convexApi.getEventById, { eventId, requesterId: session.userId }),
    convex.query(convexApi.listOrgEvents, { organizationId: org._id, requesterId: session.userId }),
  ]);
  if (!event || event.organizationId !== org._id) {
    redirect({ href: '/pro/weddings', locale });
  }

  const t = await getTranslations('ProPages');
  const activeCount = orgEvents.filter((e) => e.status === 'active').length;

  return (
    <ProSidebarShell
      current="weddings"
      org={{
        name: org.name,
        primaryColor: org.primaryColor,
        tier: effectiveProTier(org),
        role: org.myRole,
      }}
      user={{ name: user?.fullName }}
      eventsUsed={activeCount}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <Link
          href={`/pro/weddings/${eventId}` as never}
          className="focus-ring inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.28em] text-[color:var(--color-muted-foreground)] uppercase transition-colors hover:text-[color:var(--color-foreground)]"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} aria-hidden />
          {t('backToWedding')}
        </Link>
        <RsvpQuestionsEditor
          eventId={eventId}
          initialConfig={event!.rsvpConfig}
          unlocked={eventHasPremiumOnlyFeature(event!)}
          upgradeHref="/pro"
          showDelegation={event!.ownerId === session.userId}
        />
      </div>
    </ProSidebarShell>
  );
}
