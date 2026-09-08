import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminInvoicesTable } from '@/components/admin/admin-invoices-table';
import { AdminPageHeader } from '@/components/admin/ui/page-header';
import { AdminPage } from '@/components/admin/ui/section';

export default async function AdminInvoicesPage({
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

  return (
    <AdminShell current="invoices" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Factures"
          description="Factures one-shot (Essentiel / Premium). Les factures d'abonnement Stripe sont disponibles par organisation dans la section Abonnements."
        />
        <AdminInvoicesTable payments={payments} />
      </AdminPage>
    </AdminShell>
  );
}
