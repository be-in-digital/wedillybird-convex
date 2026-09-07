import {
  Heart,
  Hourglass,
  ListChecks,
  Banknote,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Plus,
  UserPlus,
  ArrowUpRight,
  AlertTriangle,
  MapPin,
  FileEdit,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  buildQuotaGauges,
  effectiveProTier,
  proSubscriptionBanner,
  tierHasFeature,
  BYTES_PER_GO,
  PRO_OVERAGE_EUR_MINOR,
  type ProQuotaGauges,
  type ProSubscriptionBanner,
  type QuotaStatus,
} from '@/lib/payments/entitlements';
import type { SubscriptionTier, SubscriptionStatus } from '@/lib/payments/subscriptions';

/**
 * Cockpit agence — tableau de bord du back-office pro (dark Linear-grade).
 *
 * Tout est calculé depuis des données **réelles** (query `pro:cockpit`) : KPIs
 * avec mini-séries hebdomadaires + deltas, jauges de quota, prochains mariages,
 * deadlines (pastilles de date + couple), pipeline en entonnoir et activité
 * récente. Server component (rendu unique par requête).
 */

export interface CockpitData {
  org: {
    name: string;
    subscriptionTier?: SubscriptionTier | null;
    subscriptionStatus?: SubscriptionStatus | null;
    subscriptionPeriodEnd?: number | null;
    paygCredits: number;
    /**
     * Compte offert (lien partenaire). Sans lui ici, le bandeau d'abonnement
     * ne voyait que Stripe et réclamait un forfait à une agence à qui l'on
     * venait d'en offrir un.
     */
    compedSubscription?: { expiresAt: number } | null;
  };
  usage: {
    activeEvents: number;
    storageBytes: number;
    whatsappMessagesThisMonth: number;
    seatsUsed: number;
  };
  kpis: {
    activeWeddings: number;
    pendingRsvp: number;
    totalEvents: number;
    draftEvents: number;
    weekDeadlines: number;
    weddingsThisMonth: number;
    respondedLast7: number;
    collectedMinor: number;
    paidInvoicesCount: number;
  };
  kpiTrends: {
    weddings: ReadonlyArray<number>;
    rsvp: ReadonlyArray<number>;
    tasksDone: ReadonlyArray<number>;
    revenue: ReadonlyArray<number>;
  };
  upcoming: ReadonlyArray<{
    _id: string;
    partnerA: string;
    partnerB: string;
    eventDate: number;
    timezone: string;
    venue?: string;
    daysUntil: number;
    rsvpAttending: number;
    rsvpTotal: number;
    status: 'draft' | 'active' | 'archived' | 'cancelled';
  }>;
  pipeline: ReadonlyArray<{
    stage: 'lead' | 'contacted' | 'quote' | 'booked' | 'in_progress' | 'delivered';
    count: number;
  }>;
  deadlines: ReadonlyArray<{
    _id: string;
    title: string;
    dueDate: number;
    daysUntil: number;
    eventId: string;
    coupleLabel: string;
  }>;
  overdueTasks: number;
  recentActivity?: ReadonlyArray<{
    kind: 'client' | 'task' | 'event' | 'event_draft';
    label: string;
    daysAgo: number;
  }>;
  rsvpTrend?: ReadonlyArray<number>;
  userName?: string | null;
  locale: string;
}

type Tone = 'pos' | 'neg' | 'neutral';
const TONE_COLOR: Record<Tone, string> = {
  pos: 'var(--color-sage-500)',
  neg: 'var(--color-warning)',
  neutral: 'var(--color-muted-foreground)',
};

type T = Awaited<ReturnType<typeof getTranslations>>;

function relAgo(days: number, t: T): string {
  if (days <= 0) return t('cockpit.relToday');
  if (days === 1) return t('cockpit.relYesterday');
  return t('cockpit.relDaysAgo', { n: days });
}

function formatGo(bytes: number, t: T): string {
  const go = bytes / BYTES_PER_GO;
  return t('cockpit.goValue', {
    value: go >= 10 || go === 0 ? String(Math.round(go)) : go.toFixed(1),
  });
}

function formatEurMinor(minor: number, locale: string): string {
  const eur = minor / 100;
  return `${eur.toLocaleString(locale, { minimumFractionDigits: eur % 1 === 0 ? 0 : 2 })} €`;
}

function clockNow(): number {
  return Date.now();
}

/** Sparkline SVG compacte (courbe + aire) teintée par tonalité. */
function Sparkline({
  values,
  color,
  width = 96,
  height = 30,
}: {
  values: ReadonlyArray<number>;
  color: string;
  width?: number;
  height?: number;
}) {
  const n = values.length;
  if (n === 0) return null;
  const max = Math.max(1, ...values);
  const stepX = n > 1 ? width / (n - 1) : width;
  const yOf = (v: number) => height - (v / max) * (height - 4) - 2;
  const pts = values.map((v, i) => `${(i * stepX).toFixed(1)},${yOf(v).toFixed(1)}`);
  const area = `0,${height} ${pts.join(' ')} ${((n - 1) * stepX).toFixed(1)},${height}`;
  const lastV = values[n - 1] ?? 0;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      className="flex-shrink-0"
    >
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={(n - 1) * stepX} cy={yOf(lastV)} r={2.4} fill={color} />
    </svg>
  );
}

export async function Cockpit(data: CockpitData) {
  const {
    org,
    usage,
    kpis,
    kpiTrends,
    upcoming,
    pipeline,
    deadlines,
    overdueTasks,
    recentActivity,
    locale,
  } = data;
  const t = await getTranslations('Pro.main');
  const nf = new Intl.NumberFormat(locale);
  // Deux lectures du palier, volontairement distinctes :
  //  - `tier` (effectif) décide de ce qui est OUVERT — jauges, bouton CRM,
  //    cadenas de la sidebar. Un cadeau expiré referme tout.
  //  - `org.subscriptionTier` (brut) alimente le bandeau, qui doit distinguer
  //    « rien choisi » d'une résiliation : les confondre ferait annoncer
  //    « aucun forfait » à une agence dont l'abonnement vient d'être résilié.
  const tier = effectiveProTier(org);
  const gauges = tier ? buildQuotaGauges(tier, usage) : null;
  const hasActivity = !!(recentActivity && recentActivity.length > 0);

  const today = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  const greeting = data.userName
    ? t('cockpit.greetingWithName', { date: capitalize(today), name: data.userName })
    : capitalize(today);

  const kpiCards: {
    key: string;
    Icon: LucideIcon;
    label: string;
    value: string;
    spark: ReadonlyArray<number>;
    delta: string;
    note: string;
    tone: Tone;
  }[] = [
    {
      key: 'weddings',
      Icon: Heart,
      label: t('cockpit.kpiActiveWeddings'),
      value: nf.format(kpis.activeWeddings),
      spark: kpiTrends.weddings,
      delta: kpis.weddingsThisMonth > 0 ? `+${kpis.weddingsThisMonth}` : '±0',
      note:
        kpis.weddingsThisMonth > 0
          ? t('cockpit.kpiThisMonth')
          : t('cockpit.kpiTotalCount', { count: nf.format(kpis.totalEvents) }),
      tone: kpis.weddingsThisMonth > 0 ? 'pos' : 'neutral',
    },
    {
      key: 'rsvp',
      Icon: Hourglass,
      label: t('cockpit.kpiPendingRsvp'),
      value: nf.format(kpis.pendingRsvp),
      spark: kpiTrends.rsvp,
      delta: nf.format(kpis.respondedLast7),
      note: t('cockpit.kpiResponses7d'),
      tone: kpis.respondedLast7 > 0 ? 'pos' : 'neutral',
    },
    {
      key: 'deadlines',
      Icon: ListChecks,
      label: t('cockpit.kpiDeadlines7d'),
      value: nf.format(kpis.weekDeadlines),
      spark: kpiTrends.tasksDone,
      delta: overdueTasks > 0 ? nf.format(overdueTasks) : '0',
      note: overdueTasks > 0 ? t('cockpit.kpiOverdue') : t('cockpit.kpiUpToDate'),
      tone: overdueTasks > 0 ? 'neg' : 'pos',
    },
    {
      key: 'revenue',
      Icon: Banknote,
      label: t('cockpit.kpiRevenue'),
      value: formatEurMinor(kpis.collectedMinor, locale),
      spark: kpiTrends.revenue,
      delta: nf.format(kpis.paidInvoicesCount),
      note: t('cockpit.kpiPaidInvoices'),
      tone: 'neutral',
    },
  ];

  return (
    <div className="container-page flex flex-col gap-6 py-8 sm:py-10">
      {/* Head */}
      <header className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-muted-foreground)] uppercase">
            {t('cockpit.eyebrow', { org: org.name })}
          </span>
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1">
              <h1
                className="font-display text-balance italic"
                style={{
                  fontSize: 'clamp(1.9rem, 4vw, 2.75rem)',
                  lineHeight: 1.05,
                  letterSpacing: '-0.022em',
                  color: 'var(--color-foreground)',
                }}
              >
                {t('cockpit.heading')}
              </h1>
              <p className="text-sm text-[color:var(--color-muted-foreground)]">{greeting}</p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2.5">
              {tierHasFeature(tier, 'crmPipeline') ? (
                <Link
                  href={'/pro/clients?new=1' as never}
                  className={cn(buttonVariants({ variant: 'outline', size: 'md' }))}
                >
                  <UserPlus className="h-4 w-4" strokeWidth={2} aria-hidden />
                  {t('cockpit.newClient')}
                </Link>
              ) : null}
              <Link
                href={'/pro/weddings?new=1' as never}
                className={cn(buttonVariants({ variant: 'primary', size: 'md' }))}
              >
                <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden />
                {t('cockpit.newWedding')}
              </Link>
            </div>
          </div>
        </div>

        <SubscriptionBanner
          tier={org.subscriptionTier ?? null}
          status={org.subscriptionStatus ?? null}
          periodEnd={org.subscriptionPeriodEnd ?? null}
          paygCredits={org.paygCredits}
          compedSubscription={org.compedSubscription ?? null}
          locale={locale}
          t={t}
        />
      </header>

      {/* KPIs réels (valeur + mini-série + delta) */}
      <section
        aria-label={t('cockpit.kpiSectionAria')}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {kpiCards.map((k) => {
          const Arrow =
            k.tone === 'pos' ? TrendingUp : k.tone === 'neg' ? TrendingDown : ArrowRight;
          return (
            <article
              key={k.key}
              className="flex flex-col gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 sm:p-5"
            >
              <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] text-[color:var(--color-muted-foreground)] uppercase">
                <k.Icon className="h-3 w-3 flex-shrink-0" strokeWidth={1.9} aria-hidden />
                {k.label}
              </span>
              <div className="flex items-end justify-between gap-2">
                <span className="font-mono text-[1.7rem] leading-none font-medium tracking-tight text-[color:var(--color-foreground)] tabular-nums">
                  {k.value}
                </span>
                <Sparkline values={k.spark} color={TONE_COLOR[k.tone]} />
              </div>
              <span
                className="inline-flex items-center gap-1 text-[11px]"
                style={{ color: TONE_COLOR[k.tone] }}
              >
                <Arrow className="h-3 w-3 flex-shrink-0" strokeWidth={2.1} aria-hidden />
                <b className="font-semibold">{k.delta}</b>
                <span className="text-[color:var(--color-muted-foreground)]"> · {k.note}</span>
              </span>
            </article>
          );
        })}
      </section>

      {/* Aperçu : prochains mariages (héros) · consommation du forfait */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
        {/* Prochains mariages */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2
              className="font-display text-xl text-[color:var(--color-foreground)] italic"
              style={{ letterSpacing: '-0.018em' }}
            >
              {t('cockpit.upcomingWeddings')}
            </h2>
            <Link
              href="/pro/weddings"
              className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.16em] text-[color:var(--color-muted-foreground)] uppercase transition-colors hover:text-[color:var(--color-foreground)]"
            >
              {t('cockpit.seeAll')} <ArrowRight className="h-3 w-3" strokeWidth={2} aria-hidden />
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <EmptyUpcoming t={t} />
          ) : (
            <ul className="flex flex-col gap-3">
              {upcoming.map((w) => (
                <UpcomingRow key={w._id} wedding={w} locale={data.locale} nf={nf} t={t} />
              ))}
            </ul>
          )}
        </section>

        {/* Quotas */}
        <section className="flex flex-col gap-4">
          <h2
            className="font-display text-xl text-[color:var(--color-foreground)] italic"
            style={{ letterSpacing: '-0.018em' }}
          >
            {t('cockpit.planConsumption')}
          </h2>
          {gauges ? (
            <QuotaCard gauges={gauges} usage={usage} locale={locale} nf={nf} t={t} />
          ) : (
            <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 text-sm text-[color:var(--color-muted-foreground)]">
              {t('cockpit.noSubscriptionQuotas')}
            </div>
          )}
        </section>
      </div>

      {/* Suivi opérationnel : deadlines · pipeline · activité — trio de même poids visuel,
          hauteurs égales (stretch) + plancher min sur desktop. */}
      <div
        className={cn(
          'grid grid-cols-1 items-stretch gap-5 lg:[&>section]:min-h-[20rem]',
          hasActivity ? 'md:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-2',
        )}
      >
        {/* Deadlines & tâches */}
        <DeadlinesCard deadlines={deadlines} overdueTasks={overdueTasks} locale={locale} t={t} />

        {/* Pipeline (entonnoir) */}
        <PipelineCard pipeline={pipeline} nf={nf} t={t} />

        {/* Activité récente */}
        {hasActivity ? <ActivityCard activity={recentActivity!} t={t} /> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Deadlines & tâches                                                          */
/* -------------------------------------------------------------------------- */

function DeadlinesCard({
  deadlines,
  overdueTasks,
  locale,
  t,
}: {
  deadlines: CockpitData['deadlines'];
  overdueTasks: number;
  locale: string;
  t: T;
}) {
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short' });
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg text-[color:var(--color-foreground)] italic">
          {t('cockpit.deadlinesTitle')}
        </h2>
        <span
          className={cn(
            'font-mono text-[10px] tracking-[0.16em] uppercase',
            overdueTasks > 0
              ? 'text-[color:var(--color-danger)]'
              : 'text-[color:var(--color-muted-foreground)]',
          )}
        >
          {overdueTasks > 0
            ? t('cockpit.overdueCount', { count: overdueTasks })
            : t('cockpit.retroPlanning')}
        </span>
      </div>
      {deadlines.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          {t('cockpit.noDeadlines')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[color:var(--color-border)]">
          {deadlines.map((d) => {
            const when: 'late' | 'today' | 'soon' =
              d.daysUntil < 0 ? 'late' : d.daysUntil === 0 ? 'today' : 'soon';
            const due = new Date(d.dueDate);
            const chipTone =
              when === 'late'
                ? 'bg-[oklch(28%_0.05_25)] text-[oklch(84%_0.09_25)]'
                : when === 'today'
                  ? 'bg-[color:var(--color-blush-500)]/15 text-[color:var(--color-blush-300)]'
                  : 'bg-[color:var(--color-surface-elevated)] text-[color:var(--color-muted-foreground)]';
            return (
              <li key={d._id} className="flex items-center gap-3 py-2.5">
                <span
                  className={cn(
                    'flex h-10 w-11 flex-shrink-0 flex-col items-center justify-center rounded-lg font-mono leading-none',
                    chipTone,
                  )}
                >
                  <span className="text-sm font-semibold">{due.getDate()}</span>
                  <span className="mt-0.5 text-[8px] tracking-[0.06em] uppercase">
                    {monthFmt.format(due)}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm text-[color:var(--color-foreground)]">
                    {d.title}
                  </span>
                  {d.coupleLabel ? (
                    <span className="font-display truncate text-xs text-[color:var(--color-muted-foreground)] italic">
                      {d.coupleLabel}
                    </span>
                  ) : null}
                </span>
                {when === 'late' ? (
                  <span className="flex-shrink-0 rounded-full bg-[oklch(28%_0.05_25)] px-2 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[oklch(84%_0.09_25)] uppercase">
                    {t('cockpit.late')}
                  </span>
                ) : when === 'today' ? (
                  <span className="flex-shrink-0 rounded-full bg-[color:var(--color-blush-500)]/15 px-2 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[color:var(--color-blush-300)] uppercase">
                    {t('cockpit.today')}
                  </span>
                ) : (
                  <span className="flex-shrink-0 font-mono text-[10px] text-[color:var(--color-muted-foreground)]">
                    {t('cockpit.jUntil', { n: d.daysUntil })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pipeline (entonnoir)                                                        */
/* -------------------------------------------------------------------------- */

function PipelineCard({
  pipeline,
  nf,
  t,
}: {
  pipeline: CockpitData['pipeline'];
  nf: Intl.NumberFormat;
  t: T;
}) {
  const countOf = (s: string) => pipeline.find((p) => p.stage === s)?.count ?? 0;
  const stages = [
    {
      key: 'leads',
      label: t('cockpit.stageLeads'),
      val: countOf('lead') + countOf('contacted'),
      color: 'oklch(72% 0.1 250)',
    },
    {
      key: 'quotes',
      label: t('cockpit.stageQuotes'),
      val: countOf('quote'),
      color: 'oklch(80% 0.1 80)',
    },
    {
      key: 'booked',
      label: t('cockpit.stageBooked'),
      val: countOf('booked') + countOf('in_progress') + countOf('delivered'),
      color: 'var(--color-sage-500)',
    },
  ];
  const total = stages.reduce((a, s) => a + s.val, 0);
  const max = Math.max(1, ...stages.map((s) => s.val));
  const conv = total > 0 ? Math.round((stages[2]!.val / total) * 100) : 0;

  return (
    <section className="flex flex-col gap-3.5 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg text-[color:var(--color-foreground)] italic">
          {t('cockpit.pipelineTitle')}
        </h2>
        <Link
          href="/pro/clients"
          className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.16em] text-[color:var(--color-muted-foreground)] uppercase transition-colors hover:text-[color:var(--color-foreground)]"
        >
          {t('cockpit.seeCrm')} <ArrowRight className="h-3 w-3" strokeWidth={2} aria-hidden />
        </Link>
      </div>
      {total === 0 ? (
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          {t('cockpit.emptyPipeline')}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2.5">
            {stages.map((s) => (
              <div key={s.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-2 text-[color:var(--color-ink-700)]">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: s.color }}
                      aria-hidden
                    />
                    {s.label}
                  </span>
                  <span className="font-mono text-[color:var(--color-foreground)] tabular-nums">
                    {s.val}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-elevated)]">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max(6, (s.val / max) * 100)}%`, background: s.color }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-[color:var(--color-border)] pt-3 text-xs">
            <span className="text-[color:var(--color-muted-foreground)]">
              {t.rich('cockpit.bookingRate', {
                rate: conv,
                b: (chunks) => (
                  <b className="font-mono text-[color:var(--color-foreground)]">{chunks}</b>
                ),
              })}
            </span>
            <span className="font-mono text-[10px] tracking-[0.12em] text-[color:var(--color-muted-foreground)] uppercase">
              {t('cockpit.fileCount', { count: nf.format(total) })}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Activité récente                                                            */
/* -------------------------------------------------------------------------- */

const ACTIVITY_META: Record<string, { Icon: LucideIcon; bg: string; fg: string }> = {
  client: {
    Icon: UserPlus,
    bg: 'color-mix(in oklab, var(--color-blush-500) 18%, transparent)',
    fg: 'var(--color-blush-300)',
  },
  task: { Icon: CheckCircle2, bg: 'oklch(26% 0.04 150)', fg: 'oklch(82% 0.08 150)' },
  event: { Icon: Heart, bg: 'var(--color-accent-soft)', fg: 'var(--color-gold-300)' },
  event_draft: {
    Icon: FileEdit,
    bg: 'var(--color-surface-elevated)',
    fg: 'var(--color-muted-foreground)',
  },
};

function ActivityCard({
  activity,
  t,
}: {
  activity: NonNullable<CockpitData['recentActivity']>;
  t: T;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
      <h2 className="font-display text-lg text-[color:var(--color-foreground)] italic">
        {t('cockpit.recentActivity')}
      </h2>
      <ul className="flex flex-col gap-3">
        {activity.map((a, i) => {
          const m = ACTIVITY_META[a.kind] ?? ACTIVITY_META.event_draft!;
          return (
            <li key={`${a.kind}-${i}`} className="flex items-center gap-3">
              <span
                className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg"
                style={{ background: m.bg, color: m.fg }}
                aria-hidden
              >
                <m.Icon className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-[color:var(--color-ink-700)]">
                {a.label}
              </span>
              <span className="flex-shrink-0 font-mono text-[10px] text-[color:var(--color-muted-foreground)]">
                {relAgo(a.daysAgo, t)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Bandeau d'abonnement                                                        */
/* -------------------------------------------------------------------------- */

function resolveBanner(
  kind: Exclude<ProSubscriptionBanner, 'none'>,
  periodEnd: number | null,
  locale: string,
  t: T,
): { tone: 'danger' | 'warning' | 'info'; message: string; cta: string } {
  if (kind === 'no_plan') {
    return {
      tone: 'warning',
      message: t('cockpit.bannerNoSubscription'),
      cta: t('cockpit.bannerChoosePlan'),
    };
  }
  if (kind === 'payment_failed') {
    return {
      tone: 'danger',
      message: t('cockpit.bannerPaymentFailed'),
      cta: t('cockpit.bannerManage'),
    };
  }
  const message =
    periodEnd && periodEnd > clockNow()
      ? t('cockpit.bannerCancelledUntil', {
          date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(periodEnd)),
        })
      : t('cockpit.bannerCancelled');
  return { tone: 'warning', message, cta: t('cockpit.bannerReactivate') };
}

function SubscriptionBanner({
  tier,
  status,
  periodEnd,
  paygCredits,
  compedSubscription,
  locale,
  t,
}: {
  tier: SubscriptionTier | null;
  status: SubscriptionStatus | null;
  periodEnd: number | null;
  paygCredits: number;
  compedSubscription: { expiresAt: number } | null;
  locale: string;
  t: T;
}) {
  // La décision vit dans `lib/payments/entitlements` : c'est le même « l'agence
  // a-t-elle accès ? » que le serveur, compte offert et crédits PAYG compris.
  const kind = proSubscriptionBanner(
    {
      subscriptionTier: tier,
      subscriptionStatus: status,
      paygCredits,
      compedSubscription,
    },
    clockNow(),
  );
  if (kind === 'none') return null;

  const { tone, message, cta } = resolveBanner(kind, periodEnd, locale, t);

  const toneStyles: Record<
    'danger' | 'warning' | 'info',
    { border: string; bg: string; fg: string }
  > = {
    danger: { border: 'var(--color-danger)', bg: 'oklch(28% 0.06 25)', fg: 'oklch(85% 0.08 25)' },
    warning: { border: 'var(--color-warning)', bg: 'oklch(28% 0.05 75)', fg: 'oklch(88% 0.07 80)' },
    info: {
      border: 'var(--color-border-strong)',
      bg: 'var(--color-surface)',
      fg: 'var(--color-muted-foreground)',
    },
  };
  const s = toneStyles[tone];

  return (
    <div
      className="flex flex-col items-start justify-between gap-3 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center"
      style={{ borderColor: s.border, background: s.bg }}
    >
      <p className="flex items-start gap-2.5 text-sm" style={{ color: s.fg }}>
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden />
        {message}
      </p>
      <Link
        href="/pro/billing"
        className="focus-ring inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] px-3.5 py-1.5 text-sm font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface)]"
      >
        {cta}
        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Quota card + gauges                                                         */
/* -------------------------------------------------------------------------- */

function QuotaCard({
  gauges,
  usage,
  locale,
  nf,
  t,
}: {
  gauges: ProQuotaGauges;
  usage: CockpitData['usage'];
  locale: string;
  nf: Intl.NumberFormat;
  t: T;
}) {
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
      <Gauge
        label={t('cockpit.gaugeActiveWeddings')}
        status={gauges.events}
        format={(n) => nf.format(n)}
        overageNote={t('cockpit.overageEvent', {
          price: formatEurMinor(PRO_OVERAGE_EUR_MINOR.extraEventPerMonth, locale),
        })}
        t={t}
      />
      <Gauge
        label={t('cockpit.gaugeMessages')}
        status={gauges.messages}
        format={(n) => nf.format(n)}
        overageNote={t('cockpit.overageMessage', {
          price: formatEurMinor(PRO_OVERAGE_EUR_MINOR.whatsappMessage, locale),
        })}
        t={t}
      />
      <Gauge
        label={t('cockpit.gaugeStorage')}
        status={gauges.storage}
        format={(n) => formatGo(n, t)}
        overageNote={t('cockpit.overageStorage', {
          price: formatEurMinor(PRO_OVERAGE_EUR_MINOR.storageGoPerMonth, locale),
        })}
        rawUsed={usage.storageBytes}
        t={t}
      />
      <Gauge
        label={t('cockpit.gaugeSeats')}
        status={gauges.seats}
        format={(n) => nf.format(n)}
        overageNote={t('cockpit.overageSeat', {
          price: formatEurMinor(PRO_OVERAGE_EUR_MINOR.extraSeatPerMonth, locale),
        })}
        t={t}
      />
    </div>
  );
}

function Gauge({
  label,
  status,
  format,
  overageNote,
  t,
}: {
  label: string;
  status: QuotaStatus;
  format: (n: number) => string;
  overageNote: string;
  rawUsed?: number;
  t: T;
}) {
  const pct = status.unlimited ? 0 : Math.min(100, Math.round(status.ratio * 100));
  const fill =
    status.level === 'danger'
      ? 'var(--color-danger)'
      : status.level === 'warning'
        ? 'var(--color-warning)'
        : 'var(--color-blush-400)';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-[color:var(--color-foreground)]">{label}</span>
        <span className="font-mono text-[11px] text-[color:var(--color-muted-foreground)] tabular-nums">
          {status.unlimited ? (
            <>
              {format(status.used)} <span className="opacity-60">· {t('cockpit.unlimited')}</span>
            </>
          ) : (
            <>
              <b className="text-[color:var(--color-foreground)]">{format(status.used)}</b> /{' '}
              {format(status.included ?? 0)}
            </>
          )}
        </span>
      </div>
      {!status.unlimited ? (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-elevated)]"
          role="progressbar"
          aria-valuenow={status.used}
          aria-valuemax={status.included ?? undefined}
          aria-label={label}
        >
          <span
            className="block h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: fill }}
          />
        </div>
      ) : (
        <div
          className="h-1.5 w-full rounded-full bg-[color:var(--color-surface-elevated)]"
          aria-hidden
        />
      )}
      {status.overage > 0 ? (
        <span className="font-mono text-[10px] text-[color:var(--color-danger)]">
          {t('cockpit.overageLabel', { value: format(status.overage), note: overageNote })}
        </span>
      ) : (
        <span className="font-mono text-[10px] text-[color:var(--color-muted-foreground)]/70">
          {overageNote}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Prochains mariages                                                          */
/* -------------------------------------------------------------------------- */

const STATUS_PILL: Record<
  'draft' | 'active' | 'archived' | 'cancelled',
  { labelKey: string; bg: string; fg: string }
> = {
  active: {
    labelKey: 'cockpit.statusActive',
    bg: 'oklch(26% 0.04 145)',
    fg: 'oklch(82% 0.07 145)',
  },
  draft: { labelKey: 'cockpit.statusDraft', bg: 'oklch(28% 0.022 78)', fg: 'oklch(85% 0.04 78)' },
  archived: {
    labelKey: 'cockpit.statusArchived',
    bg: 'oklch(28% 0.012 78)',
    fg: 'oklch(72% 0.018 65)',
  },
  cancelled: {
    labelKey: 'cockpit.statusCancelled',
    bg: 'oklch(28% 0.04 25)',
    fg: 'oklch(82% 0.07 22)',
  },
};

function UpcomingRow({
  wedding,
  locale,
  nf,
  t,
}: {
  wedding: CockpitData['upcoming'][number];
  locale: string;
  nf: Intl.NumberFormat;
  t: T;
}) {
  const pill = STATUS_PILL[wedding.status];
  const dateLabel = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: wedding.timezone || 'UTC',
  }).format(new Date(wedding.eventDate));
  const pct =
    wedding.rsvpTotal > 0 ? Math.round((wedding.rsvpAttending / wedding.rsvpTotal) * 100) : 0;

  return (
    <li>
      <Link
        href={`/events/${wedding._id}` as never}
        className="focus-ring group flex flex-col gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 transition-colors hover:border-[color:var(--color-border-strong)]"
      >
        <div className="flex items-start justify-between gap-3">
          <h3
            className="font-display italic"
            style={{
              fontSize: '1.05rem',
              letterSpacing: '-0.015em',
              color: 'var(--color-foreground)',
            }}
          >
            {wedding.partnerA} <span style={{ color: 'var(--color-gold-500)' }}>&amp;</span>{' '}
            {wedding.partnerB}
          </h3>
          <span
            className="inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[9px] tracking-[0.14em] uppercase"
            style={{ background: pill.bg, color: pill.fg }}
          >
            {t(pill.labelKey as Parameters<typeof t>[0])}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">
          <span>{dateLabel}</span>
          {wedding.daysUntil >= 0 ? (
            <span>{t('cockpit.jUntil', { n: wedding.daysUntil })}</span>
          ) : (
            <span>{t('cockpit.past')}</span>
          )}
          {wedding.venue ? (
            <span className="inline-flex max-w-[160px] items-center gap-1 truncate">
              <MapPin className="h-3 w-3 flex-shrink-0" strokeWidth={1.9} aria-hidden />
              {wedding.venue}
            </span>
          ) : null}
          {wedding.rsvpTotal > 0 ? (
            <span>
              {t('cockpit.rsvpCount', {
                attending: nf.format(wedding.rsvpAttending),
                total: nf.format(wedding.rsvpTotal),
              })}
            </span>
          ) : (
            <span className="opacity-70">{t('cockpit.noGuests')}</span>
          )}
        </div>
        {wedding.rsvpTotal > 0 ? (
          <div className="h-1 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-elevated)]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${pct}%`, background: 'var(--color-sage-500)' }}
            />
          </div>
        ) : null}
      </Link>
    </li>
  );
}

function EmptyUpcoming({ t }: { t: T }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]/40 px-6 py-12 text-center">
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-surface-elevated)] text-[color:var(--color-blush-300)]"
      >
        <Heart className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <p className="max-w-xs text-sm text-[color:var(--color-muted-foreground)]">
        {t('cockpit.emptyUpcoming')}
      </p>
      <Link
        href={'/pro/weddings?new=1' as never}
        className={cn(buttonVariants({ variant: 'primary', size: 'sm' }))}
      >
        <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden />
        {t('cockpit.newWedding')}
      </Link>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
