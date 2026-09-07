import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BarChart3, Heart, Users, TrendingUp, Wallet } from 'lucide-react';
import { requireProContext } from '@/lib/pro/require-pro-context';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { ModulePlaceholder } from '@/components/pro/module-placeholder';
import { effectiveProTier, tierHasFeature } from '@/lib/payments/entitlements';
import { formatEurMinor } from '@/lib/pro/format';
import { CLIENT_STAGES, CLIENT_STAGE_LABEL } from '@/lib/pro/clients';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ProPages');
  return { title: t('analyticsMetaTitle') };
}

const NF = new Intl.NumberFormat('fr-FR');
const PCT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });

export default async function ProAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { session, org, user } = await requireProContext(locale);
  const t = await getTranslations('ProPages');
  // Palier EFFECTIF : un cadeau expiré ne doit pas laisser la fonctionnalité
  // ouverte, alors que `subscriptionTier` reste écrit sur l'organisation.
  const tier = effectiveProTier(org);
  const shellOrg = { name: org.name, primaryColor: org.primaryColor, tier, role: org.myRole };

  if (!tierHasFeature(tier, 'analyticsMulti')) {
    return (
      <ProSidebarShell current="analytics" org={shellOrg} user={{ name: user?.fullName }}>
        <ModulePlaceholder
          eyebrow={t('analyticsLockedEyebrow')}
          title={t('analyticsTitle')}
          Icon={BarChart3}
          description={t('analyticsLockedDescription')}
          capabilities={[
            t('analyticsCap1'),
            t('analyticsCap2'),
            t('analyticsCap3'),
            t('analyticsCap4'),
          ]}
          lockedUntil="agency"
        />
      </ProSidebarShell>
    );
  }

  const convex = getConvexServerClient();
  const data = await convex.query(convexApi.proAnalytics, { userId: session.userId });
  const a = data ?? {
    events: { total: 0, active: 0, draft: 0, archived: 0 },
    clients: {
      total: 0,
      byStage: { lead: 0, contacted: 0, quote: 0, booked: 0, in_progress: 0, delivered: 0 },
      bookedCount: 0,
      conversionRate: 0,
      pipelineBudgetMinor: 0,
    },
    budget: { plannedMinor: 0, paidMinor: 0 },
  };
  const maxStage = Math.max(1, ...CLIENT_STAGES.map((s) => a.clients.byStage[s]));

  return (
    <ProSidebarShell current="analytics" org={shellOrg} user={{ name: user?.fullName }}>
      <div className="container-page flex flex-col gap-8 py-8 sm:py-10">
        <header className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-muted-foreground)] uppercase">
            {t('analyticsEyebrow', { name: org.name })}
          </span>
          <h1
            className="font-display italic"
            style={{
              fontSize: 'clamp(1.9rem, 4vw, 2.75rem)',
              lineHeight: 1.05,
              letterSpacing: '-0.022em',
              color: 'var(--color-foreground)',
            }}
          >
            {t('analyticsTitle')}
          </h1>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            Icon={Heart}
            label={t('analyticsKpiActiveWeddings')}
            value={NF.format(a.events.active)}
            note={t('analyticsKpiActiveWeddingsNote', { count: NF.format(a.events.total) })}
          />
          <Kpi
            Icon={Users}
            label={t('analyticsKpiClients')}
            value={NF.format(a.clients.total)}
            note={t('analyticsKpiClientsNote', { count: NF.format(a.clients.bookedCount) })}
          />
          <Kpi
            Icon={TrendingUp}
            label={t('analyticsKpiConversion')}
            value={PCT.format(a.clients.conversionRate)}
            note={t('analyticsKpiConversionNote')}
          />
          <Kpi
            Icon={Wallet}
            label={t('analyticsKpiPipelineBudget')}
            value={formatEurMinor(a.clients.pipelineBudgetMinor)}
            note={t('analyticsKpiPipelineBudgetNote')}
          />
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
            <h2 className="font-mono text-[10px] tracking-[0.24em] text-[color:var(--color-muted-foreground)] uppercase">
              {t('analyticsPipelineByStage')}
            </h2>
            <div className="flex flex-col gap-2.5">
              {CLIENT_STAGES.map((s) => {
                const n = a.clients.byStage[s];
                const pct = Math.round((n / maxStage) * 100);
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span className="w-20 flex-shrink-0 text-xs text-[color:var(--color-muted-foreground)]">
                      {CLIENT_STAGE_LABEL[s]}
                    </span>
                    <div className="h-5 flex-1 overflow-hidden rounded-md bg-[color:var(--color-surface-elevated)]">
                      <span
                        className="block h-full rounded-md"
                        style={{
                          width: `${Math.max(n > 0 ? 6 : 0, pct)}%`,
                          background: 'var(--color-blush-400)',
                        }}
                      />
                    </div>
                    <span className="w-6 flex-shrink-0 text-right font-mono text-xs text-[color:var(--color-foreground)] tabular-nums">
                      {n}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
            <h2 className="font-mono text-[10px] tracking-[0.24em] text-[color:var(--color-muted-foreground)] uppercase">
              {t('analyticsCommittedBudget')}
            </h2>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-3xl font-medium text-[color:var(--color-foreground)] tabular-nums">
                {formatEurMinor(a.budget.paidMinor)}
              </span>
              <span className="text-xs text-[color:var(--color-muted-foreground)]">
                {t('analyticsPaidOfPlanned', {
                  planned: formatEurMinor(a.budget.plannedMinor),
                })}
              </span>
            </div>
            {a.budget.plannedMinor > 0 ? (
              <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-elevated)]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.round((a.budget.paidMinor / a.budget.plannedMinor) * 100))}%`,
                    background: 'var(--color-sage-500)',
                  }}
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </ProSidebarShell>
  );
}

function Kpi({
  Icon,
  label,
  value,
  note,
}: {
  Icon: typeof Heart;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.2em] text-[color:var(--color-muted-foreground)] uppercase">
          {label}
        </span>
        <span
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--color-surface-elevated)] text-[color:var(--color-blush-300)]"
        >
          <Icon className="h-4 w-4" strokeWidth={1.85} />
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-2xl leading-none font-medium tracking-tight text-[color:var(--color-foreground)] tabular-nums">
          {value}
        </span>
        <span className="text-xs text-[color:var(--color-muted-foreground)]">{note}</span>
      </div>
    </article>
  );
}
