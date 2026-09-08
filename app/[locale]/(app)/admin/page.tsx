import { setRequestLocale } from 'next-intl/server';
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CreditCard,
  RotateCcw,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { formatCount, formatEurCompact, formatRatio } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminRevenueChart } from '@/components/admin/admin-revenue-chart';
import { AdminUsersChart } from '@/components/admin/admin-users-chart';
import { AdminBreakdown } from '@/components/admin/admin-breakdown';
import { AdminPageHeader } from '@/components/admin/ui/page-header';
import { AdminPage, AdminSection } from '@/components/admin/ui/section';
import { AdminStat, AdminStatGrid } from '@/components/admin/ui/stat-card';

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, kpi] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.adminDashboardKpi, { adminId: session!.userId }),
  ]);

  const alerts = [
    kpi.pastDueSubscriptions > 0 && {
      href: '/admin/subscriptions',
      label: `${kpi.pastDueSubscriptions} abonnement${kpi.pastDueSubscriptions > 1 ? 's' : ''} en impayé`,
      detail: 'Relancer avant suspension automatique',
    },
    kpi.failedPaymentsCount > 0 && {
      href: '/admin/payments',
      label: `${kpi.failedPaymentsCount} paiement${kpi.failedPaymentsCount > 1 ? 's' : ''} échoué${kpi.failedPaymentsCount > 1 ? 's' : ''}`,
      detail: `${formatEurCompact(kpi.failedPaymentsAmountMinor)} non encaissés`,
    },
  ].filter(Boolean) as { href: string; label: string; detail: string }[];

  return (
    <AdminShell current="overview" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Vue d'ensemble"
          description="État de la plateforme : encaissements, base installée et points qui demandent une action."
        >
          {alerts.length > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {alerts.map((alert) => (
                <AlertBanner key={alert.href} {...alert} />
              ))}
            </div>
          ) : null}
        </AdminPageHeader>

        {/* Les deux chiffres qui décident de tout le reste, seuls sur leur ligne. */}
        <AdminStatGrid cols={2}>
          <AdminStat
            emphasis="hero"
            icon={CreditCard}
            label="Revenu net"
            value={formatEurCompact(kpi.netRevenueMinor)}
            hint={`${formatEurCompact(kpi.totalRevenueMinor)} bruts encaissés`}
            href="/admin/payments"
          />
          <AdminStat
            emphasis="hero"
            icon={TrendingUp}
            label="MRR"
            value={formatEurCompact(kpi.mrrMinor)}
            hint={`${formatCount(kpi.activeSubscriptions)} abonnements actifs`}
            href="/admin/subscriptions"
          />
        </AdminStatGrid>

        <AdminSection
          title="Indicateurs"
          description="Base installée et santé de l'encaissement."
          bare
        >
          <AdminStatGrid cols={4}>
            <AdminStat
              icon={Users}
              label="Utilisateurs"
              value={formatCount(kpi.totalUsers)}
              hint={`${formatCount(kpi.usersByRole.couple)} couples · ${formatCount(kpi.usersByRole.pro)} pros`}
              href="/admin/users"
            />
            <AdminStat
              icon={CalendarDays}
              label="Événements actifs"
              value={formatCount(kpi.activeEvents)}
              hint={`${formatCount(kpi.totalEvents)} créés au total`}
              href="/admin/events"
            />
            <AdminStat
              icon={Target}
              label="Taux de conversion"
              value={formatRatio(kpi.conversionRate)}
              hint={`${formatCount(kpi.paidEvents)} payés sur ${formatCount(kpi.totalEvents)}`}
              href="/admin/analytics"
            />
            <AdminStat
              icon={Building2}
              label="Abonnements"
              value={formatCount(kpi.activeSubscriptions)}
              hint={`${formatCount(kpi.canceledSubscriptions)} annulés`}
              tone={kpi.pastDueSubscriptions > 0 ? 'critical' : 'default'}
              delta={
                kpi.pastDueSubscriptions > 0
                  ? {
                      value: `${kpi.pastDueSubscriptions} past_due`,
                      direction: 'down',
                      good: false,
                    }
                  : undefined
              }
              href="/admin/subscriptions"
            />
            <AdminStat
              icon={RotateCcw}
              label="Remboursements"
              value={formatEurCompact(kpi.totalRefundedMinor)}
              hint={`${formatCount(kpi.refundedPaymentsCount)} paiement${kpi.refundedPaymentsCount > 1 ? 's' : ''}`}
              href="/admin/payments"
            />
            <AdminStat
              icon={AlertTriangle}
              label="Paiements échoués"
              value={formatCount(kpi.failedPaymentsCount)}
              hint={formatEurCompact(kpi.failedPaymentsAmountMinor)}
              tone={kpi.failedPaymentsCount > 0 ? 'critical' : 'default'}
              href="/admin/payments"
            />
          </AdminStatGrid>
        </AdminSection>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <AdminSection
            title="Revenus par mois"
            description="Montants encaissés, convertis en euros."
            contentClassName="p-4"
          >
            <AdminRevenueChart data={kpi.revenueByMonth} />
          </AdminSection>
          <AdminSection
            title="Nouveaux comptes par mois"
            description="Créations cumulées par rôle."
            contentClassName="p-4"
          >
            <AdminUsersChart data={kpi.usersByMonth} />
          </AdminSection>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <AdminSection title="Répartition par devise" contentClassName="p-5">
            <AdminBreakdown data={kpi.revenueByCurrency} />
          </AdminSection>
          <AdminSection title="Répartition par provider" contentClassName="p-5">
            <AdminBreakdown data={kpi.revenueByProvider} />
          </AdminSection>
        </div>
      </AdminPage>
    </AdminShell>
  );
}

/**
 * Bandeau d'alerte cliquable. L'ancienne version était une pastille sans verbe :
 * elle disait qu'il y avait un problème, pas quoi en faire. Ici le libellé porte
 * le compte et la ligne du dessous porte l'action attendue.
 */
function AlertBanner({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <Link
      href={href as never}
      className="focus-ring group flex items-start gap-2.5 rounded-lg border border-[color:var(--color-danger)]/35 bg-[color:var(--color-danger-soft)]/60 px-3 py-2.5 transition-colors hover:border-[color:var(--color-danger)]/60"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--color-danger)]"
        strokeWidth={2}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[color:var(--color-foreground)]">
          {label}
        </span>
        <span className="block text-xs text-[color:var(--color-muted-foreground)]">{detail}</span>
      </span>
    </Link>
  );
}
