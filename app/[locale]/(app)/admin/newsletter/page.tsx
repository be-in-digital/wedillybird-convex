import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { formatCount } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminNewsletterTable } from '@/components/admin/admin-newsletter-table';
import { AdminNewsletterComposer } from '@/components/admin/admin-newsletter-composer';
import { adminListNewsletterCampaignsAction } from '@/app/[locale]/(app)/admin/actions';
import { AdminPage, AdminPageHeader } from '@/components/admin/ui';

export default async function AdminNewsletterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, subscribers, campaignsResult] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.adminListNewsletterSubscribers, { adminId: session!.userId }),
    adminListNewsletterCampaignsAction(),
  ]);

  const active = subscribers.filter((s) => s.status === 'active').length;
  const campaigns = campaignsResult.ok ? campaignsResult.campaigns : [];

  return (
    <AdminShell current="newsletter" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Newsletter"
          description={`${formatCount(active)} abonnés actifs sur ${formatCount(subscribers.length)} enregistrés.`}
        />
        <AdminNewsletterComposer activeCount={active} campaigns={campaigns} />
        <AdminNewsletterTable subscribers={subscribers} />
      </AdminPage>
    </AdminShell>
  );
}
