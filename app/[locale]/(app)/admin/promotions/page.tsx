import { setRequestLocale } from 'next-intl/server';
import { AlertTriangle } from 'lucide-react';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminPromotionsBoard } from '@/components/admin/admin-promotions-board';
import { adminListPromotionsAction } from '@/app/[locale]/(app)/admin/actions';
import { AdminEmptyState } from '@/components/admin/ui/empty-state';
import { AdminPageHeader } from '@/components/admin/ui/page-header';
import { AdminPage } from '@/components/admin/ui/section';

export default async function AdminPromotionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, promos, orgs] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    adminListPromotionsAction(),
    convex.query(convexApi.adminListAllOrganizations, { adminId: session!.userId }),
  ]);

  // Seules les orgs avec un abonnement Stripe peuvent recevoir une remise directe.
  const subscribedOrgs = orgs
    .filter((o) => o.hasStripeSubscription)
    .map((o) => ({
      _id: o._id,
      name: o.name,
      subscriptionTier: o.subscriptionTier,
      subscriptionStatus: o.subscriptionStatus,
    }));

  return (
    <AdminShell current="promotions" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Promotions & remises"
          description="Coupons, codes promo et gestes commerciaux — pour les forfaits couples comme pour les abonnements pros."
        />

        {promos.ok ? (
          <AdminPromotionsBoard
            coupons={promos.coupons}
            promoCodes={promos.promoCodes}
            subscribedOrgs={subscribedOrgs}
          />
        ) : (
          <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
            <AdminEmptyState
              icon={AlertTriangle}
              title="Promotions Stripe indisponibles"
              description={
                <>
                  {promos.error}. Vérifiez que{' '}
                  <code className="font-mono text-[color:var(--color-foreground)]">
                    STRIPE_SECRET_KEY
                  </code>{' '}
                  est configurée pour cet environnement.
                </>
              }
            />
          </div>
        )}
      </AdminPage>
    </AdminShell>
  );
}
