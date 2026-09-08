import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { formatCount } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminPhotoBooksTable } from '@/components/admin/admin-photo-books-table';
import { AdminPage, AdminPageHeader } from '@/components/admin/ui';

export default async function AdminPhotoBooksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, orders] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.adminListPhotoBookOrders, { adminId: session!.userId }),
  ]);

  const pending = orders.filter((o) => o.status === 'requested' || o.status === 'in_production');

  return (
    <AdminShell current="photo-books" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Livres photo"
          description={`${formatCount(orders.length)} commande${orders.length > 1 ? 's' : ''} · ${formatCount(pending.length)} à traiter. Fabrication et expédition manuelles — faites évoluer le statut au fil de la commande.`}
        />
        <AdminPhotoBooksTable orders={orders} />
      </AdminPage>
    </AdminShell>
  );
}
