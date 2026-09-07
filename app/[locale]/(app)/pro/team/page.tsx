import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { TeamManager } from '@/components/pro/team-manager';
import { effectiveProTier } from '@/lib/payments/entitlements';

export default async function ProTeamPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const org = await convex.query(convexApi.myOrganization, { userId: session!.userId });
  if (!org) redirect({ href: '/pro/onboarding', locale });

  const members = await convex.query(convexApi.listOrgMembers, {
    organizationId: org!._id,
    requesterId: session!.userId,
  });

  const user = await convex.query(convexApi.currentUser, { userId: session!.userId });
  const t = await getTranslations('Pro');

  return (
    <ProSidebarShell
      current="team"
      org={{
        name: org!.name,
        primaryColor: org!.primaryColor,
        tier: effectiveProTier(org!),
        role: org!.myRole,
      }}
      user={{ name: user?.fullName }}
    >
      <div className="container-page flex flex-col gap-10 py-12 sm:py-16">
        <header className="flex flex-col gap-3">
          <Link
            href="/pro/dashboard"
            className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-muted-foreground)] uppercase transition-colors hover:text-[color:var(--color-foreground)]"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} aria-hidden />
            {t('backToDashboard')}
          </Link>
          <h1
            className="font-display text-balance italic"
            style={{
              fontSize: 'clamp(2rem, 4.5vw, 3rem)',
              lineHeight: 1.05,
              letterSpacing: '-0.022em',
              color: 'var(--color-foreground)',
            }}
          >
            {t('teamTitle')}
          </h1>
          <p className="text-base leading-relaxed text-[color:var(--color-muted-foreground)] sm:text-lg">
            {t('teamSubtitle')}
          </p>
        </header>

        <TeamManager
          organizationId={org!._id}
          canManage={org!.myRole === 'owner' || org!.myRole === 'admin'}
          currentUserId={session!.userId}
          myRole={org!.myRole}
          tier={effectiveProTier(org!)}
          initialMembers={members}
        />
      </div>
    </ProSidebarShell>
  );
}
