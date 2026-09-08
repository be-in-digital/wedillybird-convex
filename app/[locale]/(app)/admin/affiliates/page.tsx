import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminAffiliatesBoard } from '@/components/admin/admin-affiliates-board';
import { AdminPage } from '@/components/admin/ui/section';
import { AdminPageHeader } from '@/components/admin/ui/page-header';

/**
 * Admin affiliation (FR-only, comme le reste de /admin). Crée des affiliés
 * (invitation-only) et visualise le ledger de commissions/crédits. Le payout
 * cash reste groupé/manuel au MVP (décision conseil) ; le crédit particulier
 * est appliqué automatiquement au prochain checkout (phase 2c).
 */
export default async function AdminAffiliatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, affiliates, referrals, invites] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.listAffiliates, { adminId: session!.userId }),
    convex.query(convexApi.listReferrals, { adminId: session!.userId }),
    convex.query(convexApi.listPartnerInvites, { adminId: session!.userId }),
  ]);

  return (
    <AdminShell current="affiliates" adminName={user?.fullName ?? undefined}>
      <AdminPage>
        <AdminPageHeader
          title="Affiliation"
          description="Affiliés sur invitation. Parrainage particulier = crédit (auto) ; partenaire = cash (payout groupé, acquis à la date de l'event)."
        />
        <AdminAffiliatesBoard affiliates={affiliates} referrals={referrals} invites={invites} />
      </AdminPage>
    </AdminShell>
  );
}
