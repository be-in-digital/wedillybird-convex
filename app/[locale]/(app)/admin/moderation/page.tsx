import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { formatCount } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminModerationPanel } from '@/components/admin/admin-moderation-panel';
import { AdminPageHeader } from '@/components/admin/ui/page-header';
import { AdminPage } from '@/components/admin/ui/section';

export default async function AdminModerationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, photos, templates] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.adminListPendingPhotos, { adminId: session!.userId }),
    convex.query(convexApi.adminListAllWhatsappTemplates, { adminId: session!.userId }),
  ]);

  return (
    <AdminShell current="moderation" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Modération"
          description={`${formatCount(photos.length)} photos en attente · ${formatCount(templates.length)} templates WhatsApp.`}
        />
        <AdminModerationPanel photos={photos} templates={templates} />
      </AdminPage>
    </AdminShell>
  );
}
