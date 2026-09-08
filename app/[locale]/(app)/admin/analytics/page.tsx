import { setRequestLocale } from 'next-intl/server';
import { CalendarClock, CalendarDays, CreditCard, Timer, Users } from 'lucide-react';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { formatCount, formatEurCompact, formatRatio } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminCountChart } from '@/components/admin/admin-count-chart';
import { SERIES } from '@/components/admin/charts/chart-theme';
import { AdminFunnel, AdminMeter } from '@/components/admin/ui/meter';
import { AdminPageHeader } from '@/components/admin/ui/page-header';
import { AdminPage, AdminSection } from '@/components/admin/ui/section';
import { AdminStat, AdminStatGrid } from '@/components/admin/ui/stat-card';

/**
 * Variation relative sur 30 jours glissants. `null` quand la période précédente
 * est vide : « +∞ % » ne veut rien dire, on affiche « nouveau ».
 */
function delta(
  current: number,
  previous: number,
): { value: string; direction: 'up' | 'down' | 'flat'; good: boolean } | null {
  if (previous === 0) {
    return current > 0 ? { value: 'nouveau', direction: 'up', good: true } : null;
  }
  const change = (current - previous) / previous;
  return {
    value: `${change >= 0 ? '+' : ''}${(change * 100).toFixed(0)} %`,
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    good: change >= 0,
  };
}

const WEEKDAYS = [
  { idx: 1, label: 'Lun' },
  { idx: 2, label: 'Mar' },
  { idx: 3, label: 'Mer' },
  { idx: 4, label: 'Jeu' },
  { idx: 5, label: 'Ven' },
  { idx: 6, label: 'Sam' },
  { idx: 0, label: 'Dim' },
];

export default async function AdminAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, a] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.adminPlatformAnalytics, { adminId: session!.userId }),
  ]);

  const monthArr = (rec: Record<string, number>) =>
    Object.entries(rec)
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([m, v]) => ({ label: m.slice(2), value: v }));

  const weekdayArr = WEEKDAYS.map((w) => ({
    label: w.label,
    value: a.seasonality.eventsByWeekday[w.idx] ?? 0,
  }));

  const planTotal = a.mix.planMix.essential + a.mix.planMix.premium;
  const proTotal = a.mix.proTierMix.starter + a.mix.proTierMix.business + a.mix.proTierMix.agency;
  const totalMrr =
    a.subscriptions.mrrByTierMinor.starter +
    a.subscriptions.mrrByTierMinor.business +
    a.subscriptions.mrrByTierMinor.agency;

  return (
    <AdminShell current="analytics" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Analytics"
          description="Conversion, abandon, saisonnalité et cohortes — sur 30 jours glissants."
        />

        <AdminSection
          title="Tendance sur 30 jours"
          description="Comparé aux 30 jours précédents."
          bare
        >
          <AdminStatGrid cols={3}>
            <AdminStat
              icon={CreditCard}
              label="Revenu (30 j)"
              value={formatEurCompact(a.trend.revenueLast30Minor)}
              delta={delta(a.trend.revenueLast30Minor, a.trend.revenuePrev30Minor) ?? undefined}
              hint={`${formatEurCompact(a.trend.revenuePrev30Minor)} avant`}
            />
            <AdminStat
              icon={CreditCard}
              label="Ventes (30 j)"
              value={formatCount(a.trend.paidLast30)}
              delta={delta(a.trend.paidLast30, a.trend.paidPrev30) ?? undefined}
              hint={`${formatCount(a.trend.paidPrev30)} avant`}
            />
            <AdminStat
              icon={CalendarDays}
              label="Nouveaux events (30 j)"
              value={formatCount(a.trend.newEventsLast30)}
              delta={delta(a.trend.newEventsLast30, a.trend.newEventsPrev30) ?? undefined}
              hint={`${formatCount(a.trend.newEventsPrev30)} avant`}
            />
          </AdminStatGrid>
        </AdminSection>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <AdminSection
            title="Funnel de conversion (particuliers)"
            description="Chaque pourcentage est le passage depuis l'étape précédente."
            className="lg:col-span-2"
            contentClassName="p-5"
          >
            <AdminFunnel
              steps={[
                { label: 'Comptes couple', value: a.funnel.couplesSignedUp },
                { label: 'Events créés', value: a.funnel.eventsCreated },
                { label: 'Events publiés', value: a.funnel.eventsPublished },
                { label: 'Checkout démarré', value: a.funnel.checkoutStarted },
                { label: 'Payé', value: a.funnel.paid },
              ]}
            />
          </AdminSection>

          <AdminSection title="Abandon de checkout" contentClassName="p-5">
            <p className="text-3xl leading-none font-semibold tracking-tight text-[color:var(--color-warning)] tabular-nums">
              {formatRatio(a.checkout.abandonmentRate, locale)}
            </p>
            <p className="mt-1.5 text-xs text-[color:var(--color-muted-foreground)]">
              {formatCount(a.checkout.intentsStarted)} intents démarrés ·{' '}
              {formatCount(a.checkout.byStatus.succeeded)} aboutis
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <AdminMeter
                label="Réussis"
                value={a.checkout.byStatus.succeeded}
                total={a.checkout.intentsStarted}
                tone="success"
              />
              <AdminMeter
                label="En attente"
                value={a.checkout.byStatus.pending}
                total={a.checkout.intentsStarted}
                tone="warning"
              />
              <AdminMeter
                label="Échoués"
                value={a.checkout.byStatus.failed}
                total={a.checkout.intentsStarted}
                tone="danger"
              />
              <AdminMeter
                label="Annulés"
                value={a.checkout.byStatus.cancelled}
                total={a.checkout.intentsStarted}
                tone="neutral"
              />
              <AdminMeter
                label="Remboursés"
                value={a.checkout.byStatus.refunded}
                total={a.checkout.intentsStarted}
                tone="neutral"
              />
            </div>
          </AdminSection>
        </div>

        <AdminSection title="Rythme et panier" bare>
          <AdminStatGrid cols={4}>
            <AdminStat
              icon={Timer}
              label="Durée checkout médiane"
              value={`${a.timing.medianCheckoutMinutes.toFixed(0)} min`}
            />
            <AdminStat
              icon={CalendarClock}
              label="Délai création → paiement"
              value={`${a.timing.medianCreateToPayHours.toFixed(0)} h`}
            />
            <AdminStat
              icon={CreditCard}
              label="Panier moyen (AOV)"
              value={formatEurCompact(a.mix.aovMinor)}
            />
            <AdminStat
              icon={Users}
              label="Invités moyens / event"
              value={formatCount(a.mix.avgGuests)}
            />
          </AdminStatGrid>
        </AdminSection>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <AdminSection
            title="Rush mariages — events par mois d'événement"
            description="Quand les mariages ont lieu : c'est la charge à absorber."
            contentClassName="p-4"
          >
            <AdminCountChart data={monthArr(a.seasonality.eventsByEventMonth)} unit="events" />
          </AdminSection>
          <AdminSection
            title="Croissance — events créés par mois"
            description="Quand les comptes créent leur mariage : c'est l'acquisition."
            contentClassName="p-4"
          >
            <AdminCountChart
              data={monthArr(a.seasonality.eventsByCreatedMonth)}
              color={SERIES.blue}
              unit="events"
            />
          </AdminSection>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <AdminSection
            title="Jour de la semaine des mariages"
            className="lg:col-span-2"
            contentClassName="p-4"
          >
            <AdminCountChart data={weekdayArr} color={SERIES.gold} unit="events" />
          </AdminSection>
          <AdminSection
            title="Rush à venir"
            description="Mariages à date, cumulés."
            contentClassName="divide-y divide-[color:var(--color-border)]"
          >
            <UpcomingRow label="Sous 30 jours" value={a.seasonality.upcoming.next30} />
            <UpcomingRow label="Sous 60 jours" value={a.seasonality.upcoming.next60} />
            <UpcomingRow label="Sous 90 jours" value={a.seasonality.upcoming.next90} />
          </AdminSection>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <AdminSection title="Mix des offres" contentClassName="p-5">
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
              Particuliers (events payés)
            </p>
            <div className="mt-2.5 flex flex-col gap-2.5">
              <AdminMeter
                label="Essentiel"
                value={a.mix.planMix.essential}
                total={planTotal}
                tone="neutral"
              />
              <AdminMeter
                label="Premium"
                value={a.mix.planMix.premium}
                total={planTotal}
                tone="brand"
              />
            </div>

            <p className="mt-6 text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
              Pros (par tier)
            </p>
            <div className="mt-2.5 flex flex-col gap-2.5">
              <AdminMeter
                label="Starter"
                value={a.mix.proTierMix.starter}
                total={proTotal}
                tone="neutral"
              />
              <AdminMeter
                label="Business"
                value={a.mix.proTierMix.business}
                total={proTotal}
                tone="brand"
              />
              <AdminMeter
                label="Agency"
                value={a.mix.proTierMix.agency}
                total={proTotal}
                tone="success"
              />
            </div>
          </AdminSection>

          <AdminSection
            title={`Abonnements pro · MRR ${formatEurCompact(totalMrr)}`}
            contentClassName="p-5"
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <SubStat label="Actifs" value={a.subscriptions.byStatus.active} />
              <SubStat label="Essai" value={a.subscriptions.byStatus.trialing} />
              <SubStat label="Impayés" value={a.subscriptions.byStatus.past_due} tone="danger" />
              <SubStat label="Annulés" value={a.subscriptions.byStatus.canceled} />
              <SubStat label="Non réglés" value={a.subscriptions.byStatus.unpaid} tone="danger" />
            </div>
            <div className="mt-5 flex flex-col gap-2.5 border-t border-[color:var(--color-border)] pt-5">
              <AdminMeter
                label="Starter"
                value={a.subscriptions.mrrByTierMinor.starter}
                total={totalMrr}
                valueLabel={`${formatEurCompact(a.subscriptions.mrrByTierMinor.starter)}/mois`}
                tone="neutral"
              />
              <AdminMeter
                label="Business"
                value={a.subscriptions.mrrByTierMinor.business}
                total={totalMrr}
                valueLabel={`${formatEurCompact(a.subscriptions.mrrByTierMinor.business)}/mois`}
                tone="brand"
              />
              <AdminMeter
                label="Agency"
                value={a.subscriptions.mrrByTierMinor.agency}
                total={totalMrr}
                valueLabel={`${formatEurCompact(a.subscriptions.mrrByTierMinor.agency)}/mois`}
                tone="success"
              />
            </div>
          </AdminSection>
        </div>
      </AdminPage>
    </AdminShell>
  );
}

/** Ligne de la liste « rush à venir » — sans encadré : elle vit déjà dans une carte. */
function UpcomingRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <span className="text-sm text-[color:var(--color-muted-foreground)]">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums">{formatCount(value)}</span>
    </div>
  );
}

function SubStat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
        {label}
      </p>
      <p
        className={`mt-0.5 text-xl font-semibold tabular-nums ${
          tone === 'danger' && value > 0 ? 'text-[color:var(--color-danger)]' : ''
        }`}
      >
        {formatCount(value)}
      </p>
    </div>
  );
}
