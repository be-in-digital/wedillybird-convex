import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { formatCount } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminBugReportsTable } from '@/components/admin/admin-bug-reports-table';
import { AdminPage, AdminPageHeader } from '@/components/admin/ui';

/**
 * /admin/bug-reports — triage des signalements de bug soumis depuis l'app
 * (bouton flottant couple/agence). FR-only comme le reste de /admin.
 */
export default async function AdminBugReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, reports] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.listBugReports, { requesterId: session!.userId }),
  ]);

  const open = reports.filter((r) => r.status === 'open');

  return (
    <AdminShell current="bug-reports" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Rapports de bug"
          description={`${formatCount(reports.length)} signalement${reports.length > 1 ? 's' : ''} · ${formatCount(open.length)} à traiter. Soumis depuis le bouton flottant de l'app — faites évoluer le statut au fil du triage.`}
        />
        <AdminBugReportsTable reports={reports} />
      </AdminPage>
    </AdminShell>
  );
}
