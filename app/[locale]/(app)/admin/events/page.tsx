import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { formatCount } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminEventsTable } from '@/components/admin/admin-events-table';
import { AdminPageHeader } from '@/components/admin/ui/page-header';
import { AdminPage } from '@/components/admin/ui/section';

export default async function AdminEventsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, events] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.adminListAllEvents, { adminId: session!.userId }),
  ]);

  const active = events.filter((e) => e.status === 'active').length;

  return (
    <AdminShell current="events" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Événements"
          description={`${formatCount(events.length)} événements sur la plateforme, dont ${formatCount(active)} actifs.`}
        />
        <AdminEventsTable events={events} />
      </AdminPage>
    </AdminShell>
  );
}
