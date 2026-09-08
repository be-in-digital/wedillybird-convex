import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { formatCount } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminPaymentsTable } from '@/components/admin/admin-payments-table';
import { AdminPageHeader } from '@/components/admin/ui/page-header';
import { AdminPage } from '@/components/admin/ui/section';

export default async function AdminPaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, payments] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.adminListAllPayments, { adminId: session!.userId }),
  ]);

  const failed = payments.filter((p) => p.status === 'failed').length;

  return (
    <AdminShell current="payments" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Paiements"
          description={
            failed > 0
              ? `${formatCount(payments.length)} transactions enregistrées — ${formatCount(failed)} en échec.`
              : `${formatCount(payments.length)} transactions enregistrées.`
          }
        />
        <AdminPaymentsTable payments={payments} />
      </AdminPage>
    </AdminShell>
  );
}
