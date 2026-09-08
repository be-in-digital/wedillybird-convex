import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { formatCount } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminAuditLogTable } from '@/components/admin/admin-audit-log-table';
import { AdminPage, AdminPageHeader } from '@/components/admin/ui';

export default async function AdminAuditLogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, logs] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.adminListAuditLog, { adminId: session!.userId }),
  ]);

  return (
    <AdminShell current="audit-log" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Journal d'audit"
          description={`${formatCount(logs.length)} actions d'administration enregistrées, de la plus récente à la plus ancienne.`}
        />
        <AdminAuditLogTable logs={logs} />
      </AdminPage>
    </AdminShell>
  );
}
