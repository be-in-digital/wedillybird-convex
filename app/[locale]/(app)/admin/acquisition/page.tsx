import { setRequestLocale } from 'next-intl/server';
import { ExternalLink, Eye, KeyRound, PlayCircle, TriangleAlert, Users } from 'lucide-react';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import {
  getAcquisitionAnalytics,
  getRecentSessions,
  replayUrl,
  replayListUrl,
  type RecentSessions,
} from '@/lib/analytics/posthog-query';
import { formatCount, formatDateTime } from '@/lib/admin/format';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminCountChart } from '@/components/admin/admin-count-chart';
import { SERIES } from '@/components/admin/charts/chart-theme';
import { AdminEmptyState } from '@/components/admin/ui/empty-state';
import { AdminFunnel } from '@/components/admin/ui/meter';
import { AdminPageHeader } from '@/components/admin/ui/page-header';
import { AdminPage, AdminSection } from '@/components/admin/ui/section';
import { AdminStat, AdminStatGrid } from '@/components/admin/ui/stat-card';

/** Libellés lisibles des ids de section de la landing (`section_viewed.id`). */
const SECTION_LABELS: Record<string, string> = {
  features: 'Fonctionnalités',
  pricing: 'Tarifs',
  faq: 'FAQ',
};

/**
 * Acquisition — analytics MARKETING (PostHog) dans le back-office Super Admin.
 *
 * Complète `/admin/analytics` (données backend Convex, à partir des comptes
 * créés) en montrant le HAUT du funnel : visiteurs, CTA, et où ça décroche
 * AVANT l'inscription. Lecture via l'API Query PostHog (cf. posthog-query.ts).
 *
 * Le contrôle du rôle admin est assuré par `admin/layout.tsx` (redirige les
 * non-admins). Ici on ne fait que récupérer le nom pour la sidebar.
 */
export default async function AdminAcquisitionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, data, sessions] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    getAcquisitionAnalytics(30),
    getRecentSessions(8),
  ]);

  return (
    <AdminShell current="acquisition" adminName={user?.fullName}>
      <AdminPage>
        <AdminPageHeader
          title="Acquisition"
          eyebrow="Source PostHog · 30 jours glissants"
          description={
            <>
              Trafic, CTA et funnel marketing — ce qui se passe <em>avant</em> l&apos;inscription.
            </>
          }
        />

        {data.state === 'not_configured' ? (
          <SetupNotice />
        ) : data.state === 'error' ? (
          <ErrorNotice message={data.message} />
        ) : (
          <>
            <AdminStatGrid cols={2}>
              <AdminStat
                emphasis="hero"
                icon={Eye}
                label="Pages vues (30 j)"
                value={formatCount(data.traffic.pageviews)}
              />
              <AdminStat
                emphasis="hero"
                icon={Users}
                label="Visiteurs uniques (30 j)"
                value={formatCount(data.traffic.uniqueVisitors)}
              />
            </AdminStatGrid>

            <AdminSection
              title="Funnel marketing — visite → achat"
              description="Ce funnel précède l'étape « Comptes couple » de la page Analytics."
              contentClassName="p-5"
            >
              <AdminFunnel steps={data.funnel} />
            </AdminSection>

            <AdminSection
              title="Clics CTA par source"
              description="Quel emplacement déclenche réellement le passage à l'action."
              contentClassName="p-4"
            >
              <AdminCountChart data={data.ctaBySource} unit="clics" />
            </AdminSection>

            {/* Comportement sur la landing — ce qui dit quoi améliorer.
                Mesuré pour TOUS les visiteurs (mode sans cookie), pas
                seulement ceux qui acceptent la bannière. */}
            <AdminSection
              title="Comportement sur la landing"
              description="Jusqu'où les visiteurs descendent, quelles objections ils ouvrent, s'ils essaient la démo. Une section qui perd la moitié des visiteurs est la prochaine à retravailler."
              contentClassName="flex flex-col gap-6 p-5"
            >
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1fr]">
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium text-[color:var(--color-foreground)]">
                    Visiteurs uniques ayant atteint chaque section
                  </h3>
                  <AdminFunnel
                    steps={data.landing.sectionsReached.map((s) => ({
                      label: SECTION_LABELS[s.label] ?? s.label,
                      value: s.value,
                    }))}
                  />
                </div>
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium text-[color:var(--color-foreground)]">
                    Questions FAQ ouvertes
                  </h3>
                  <AdminCountChart
                    data={data.landing.faqOpened}
                    color={SERIES.gold}
                    unit="ouvertures"
                  />
                </div>
              </div>
              <AdminStatGrid cols={2}>
                <AdminStat
                  icon={PlayCircle}
                  label={`RSVP de démonstration envoyés (${data.days} j)`}
                  value={formatCount(data.landing.demoRsvp)}
                  hint="Visiteurs qui ont joué la démo /demo jusqu'au bout."
                />
                <AdminStat
                  icon={Eye}
                  label="Pages vues sans cookie"
                  value={
                    data.landing.cookielessShare === null
                      ? '—'
                      : `${Math.round(data.landing.cookielessShare * 100)} %`
                  }
                  hint={
                    data.landing.cookielessShare === null
                      ? 'Aucune page vue sur la période, ou mode sans cookie non activé dans PostHog.'
                      : 'Part des visiteurs observés sans consentement (mode sans cookie). Le reste a accepté la bannière : replay disponible.'
                  }
                />
              </AdminStatGrid>
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-[color:var(--color-foreground)]">
                  Pages vues par chemin
                </h3>
                <AdminCountChart data={data.landing.pagesByPath} color={SERIES.blue} unit="vues" />
              </div>
            </AdminSection>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <AdminSection title="Inscriptions par langue" contentClassName="p-4">
                <AdminCountChart data={data.signupByLocale} color={SERIES.blue} unit="signups" />
              </AdminSection>
              <AdminSection title="Forfaits sélectionnés par tier" contentClassName="p-4">
                <AdminCountChart data={data.planByTier} color={SERIES.gold} unit="sélections" />
              </AdminSection>
            </div>
          </>
        )}

        <AdminSection
          title="Rejeux de session"
          description="Regarder comment les visiteurs naviguent vraiment, pour repérer les frictions."
          actions={
            <a
              href={replayListUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring inline-flex items-center gap-1.5 rounded-md px-1 text-xs font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
            >
              Tout voir <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          }
        >
          <SessionsList sessions={sessions} />
        </AdminSection>

        <p className="text-xs text-[color:var(--color-muted-foreground)]">
          Pages vues, sections, CTA, FAQ et démo sont mesurés pour tous les visiteurs, sans cookie
          (mode « cookieless » à activer dans PostHog → Settings). Replay, heatmaps et profils
          n&apos;existent que pour les visiteurs qui ont accepté la bannière. Les events de paiement
          sont envoyés côté serveur.
        </p>
      </AdminPage>
    </AdminShell>
  );
}

function SetupNotice() {
  return (
    <div className="rounded-xl border border-[color:var(--color-warning)]/35 bg-[color:var(--color-surface)]">
      <AdminEmptyState
        icon={KeyRound}
        title="Analytics marketing à activer"
        description={
          <>
            Cette vue lit les données PostHog via l&apos;API Query, qui nécessite une clé
            personnelle. Créez une clé scopée <Code>query:read</Code> dans PostHog (Settings →
            Personal API keys), puis posez-la en variable d&apos;environnement{' '}
            <Code>POSTHOG_PERSONAL_API_KEY</Code> (Vercel production + <Code>.env.local</Code>). La
            page s&apos;activera automatiquement.
          </>
        }
      />
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--color-danger)]/35 bg-[color:var(--color-surface)]">
      <AdminEmptyState
        icon={TriangleAlert}
        title="Requête PostHog en échec"
        description={
          <>
            La clé est peut-être invalide ou sans le scope <Code>query:read</Code>.
            <span className="mt-2 block font-mono text-xs break-all">{message}</span>
          </>
        }
      />
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-[color:var(--color-surface-elevated)] px-1 py-0.5 font-mono text-xs text-[color:var(--color-foreground)]">
      {children}
    </code>
  );
}

function StateText({ children }: { children: React.ReactNode }) {
  return <p className="p-5 text-sm text-[color:var(--color-muted-foreground)]">{children}</p>;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m} m ${s.toString().padStart(2, '0')} s`;
}

function SessionsList({ sessions }: { sessions: RecentSessions }) {
  if (sessions.state === 'not_configured') {
    return <StateText>Clé PostHog non configurée.</StateText>;
  }
  if (sessions.state === 'scope_missing') {
    return (
      <StateText>
        Ajoutez le scope <Code>session_recording:read</Code> à la clé pour lister les sessions ici
        (« Tout voir » reste disponible).
      </StateText>
    );
  }
  if (sessions.state === 'error') {
    return <StateText>Erreur PostHog : {sessions.message}</StateText>;
  }
  if (sessions.sessions.length === 0) {
    return (
      <AdminEmptyState
        icon={PlayCircle}
        title="Aucune session enregistrée"
        description="Le replay vient d'être activé : les sessions consenties apparaîtront ici au fil du trafic."
        compact
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-[color:var(--color-border)]">
      {sessions.sessions.map((s) => (
        <li key={s.id}>
          <a
            href={replayUrl(s.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--color-surface-elevated)]"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">
                {s.startTime ? formatDateTime(new Date(s.startTime).getTime()) : '—'}
              </span>
              <span className="truncate font-mono text-[0.6875rem] text-[color:var(--color-muted-foreground)]">
                {s.startUrl ?? s.person ?? '—'}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-[color:var(--color-muted-foreground)]">
              <span className="font-mono tabular-nums">{formatDuration(s.durationSec)}</span>
              <span className="hidden font-mono tabular-nums sm:inline">{s.clicks} clics</span>
              <ExternalLink className="h-3.5 w-3.5 text-[color:var(--color-primary)]" aria-hidden />
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
