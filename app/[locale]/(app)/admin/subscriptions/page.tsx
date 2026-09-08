import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { formatCount } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminSubscriptionsTable } from '@/components/admin/admin-subscriptions-table';
import { AdminPage, AdminPageHeader } from '@/components/admin/ui';

export default async function AdminSubscriptionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, orgs] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.adminListAllOrganizations, { adminId: session!.userId }),
  ]);

  const pastDue = orgs.filter((o) => o.subscriptionStatus === 'past_due').length;

  return (
    <AdminShell current="subscriptions" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Abonnements Pro"
          description={
            pastDue > 0
              ? `${formatCount(orgs.length)} organisations enregistrées — ${formatCount(pastDue)} en impayé.`
              : `${formatCount(orgs.length)} organisations enregistrées.`
          }
        />
        <AdminSubscriptionsTable organizations={orgs} />
      </AdminPage>
    </AdminShell>
  );
}
