import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { AppShell } from '@/components/app/app-shell';
import { EventCreateWizard } from '@/components/events/event-create-wizard';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'EventCreate' });
  return { title: t('title') };
}

export default async function NewEventPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) {
    redirect({ href: '/sign-in', locale });
  }

  const convex = getConvexServerClient();
  const [user, organization] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    // Même source que `createEventAction` : c'est elle qui décide du
    // rattachement, donc c'est elle qui doit décider de l'étape « forfait ».
    convex.query(convexApi.myOrganization, { userId: session!.userId }),
  ]);
  if (!user?.fullName) {
    redirect({ href: '/onboarding', locale });
  }

  const t = await getTranslations('EventCreate');

  return (
    <AppShell userName={user!.fullName}>
      <div className="container-page mx-auto flex max-w-2xl flex-col gap-10 py-12 sm:py-16">
        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase transition-colors hover:text-[color:var(--color-ink-900)]"
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
              color: 'var(--color-ink-900)',
            }}
          >
            {t('title')}
          </h1>
          <p className="text-base leading-relaxed text-[color:var(--color-ink-500)] sm:text-lg">
            {t('description')}
          </p>
        </div>

        <EventCreateWizard hasOrganization={Boolean(organization)} />
      </div>
    </AppShell>
  );
}
