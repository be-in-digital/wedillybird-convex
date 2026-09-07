import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Sparkles, ArrowLeft } from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { buttonVariants } from '@/components/ui/button';
import { AppShell } from '@/components/app/app-shell';
import { getPaymentDriver } from '@/lib/payments';
import type { ProviderName } from '@/lib/payments/country';
import { taxExclusiveMinor } from '@/lib/payments/vat';
import { cn } from '@/lib/cn';
import { captureServer, EVENTS } from '@/lib/analytics/posthog-server';

function isProviderName(value: string | undefined): value is ProviderName {
  return value === 'stripe' || value === 'mock';
}

export default async function UpgradeSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; eventId: string }>;
  searchParams: Promise<{ session_id?: string; provider?: string }>;
}) {
  const { locale, eventId } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) {
    redirect({ href: '/sign-in', locale });
  }

  const convex = getConvexServerClient();

  // Fallback finalization (idempotent) si webhook pas encore arrivé.
  let reconciliationFailed = false;
  if (sp.session_id) {
    const provider: ProviderName = isProviderName(sp.provider) ? sp.provider : 'stripe';
    try {
      const driver = getPaymentDriver(provider);
      const status = await driver.retrieveSessionStatus(sp.session_id);
      if (status.paid) {
        const webhookSecret = process.env.CONVEX_WEBHOOK_SECRET;
        if (!webhookSecret) throw new Error('WEBHOOK_SECRET_NOT_CONFIGURED');
        await convex.mutation(convexApi.markPaymentSucceeded, {
          webhookSecret,
          provider,
          providerSessionId: status.providerSessionId,
          providerEventId: status.providerEventId,
          // Encaissement réel, assiette HT et code promo, comme le webhook : si
          // ce filet gagne la course, la commission d'affiliation doit être
          // calculée sur les mêmes bases (le driver mock ne connaît pas le
          // montant, on ne lui fait donc pas dire 0).
          ...(provider === 'stripe'
            ? {
                netMinor: status.amountMinor,
                commissionBaseMinor: taxExclusiveMinor(status.amountMinor, status.currency),
                promotionCode: status.promotionCode,
              }
            : {}),
        });
      }
    } catch (err) {
      reconciliationFailed = true;
      // T2-3 : ce filet était catché puis affiché à l'utilisateur mais jamais
      // remonté ops — silence exact relevé au premortem. `captureServer`
      // n'échoue jamais (garde interne), donc ne bloque pas le rendu de page.
      const message = err instanceof Error ? err.message : 'UNKNOWN';
      await captureServer({
        distinctId: session!.userId,
        event: EVENTS.paymentReconciliationFailed,
        properties: {
          event_id: eventId,
          provider,
          session_id: sp.session_id,
          message,
        },
      });
    }
  }

  const event = await convex.query(convexApi.getEventById, {
    eventId,
    requesterId: session!.userId,
  });
  if (!event) notFound();

  const user = await convex.query(convexApi.currentUser, { userId: session!.userId });
  const t = await getTranslations('Upgrade');
  const isPending = event.planTier === undefined;

  return (
    <AppShell userName={user?.fullName}>
      <div className="container-page mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-7 py-16 text-center">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full text-white shadow-[var(--shadow-blush)]"
          style={{
            background: isPending
              ? 'linear-gradient(135deg, oklch(78% 0.075 78) 0%, oklch(58% 0.075 80) 100%)'
              : 'linear-gradient(135deg, oklch(72% 0.09 20) 0%, oklch(58% 0.075 80) 100%)',
          }}
          aria-hidden
        >
          <Sparkles className="h-7 w-7" strokeWidth={1.75} />
        </span>
        <h1
          className="font-display text-balance italic"
          style={{
            fontSize: 'clamp(2rem, 4.5vw, 3rem)',
            lineHeight: 1.05,
            letterSpacing: '-0.022em',
            color: 'var(--color-ink-900)',
          }}
        >
          {isPending ? t('processingTitle') : t('successTitle')}
        </h1>
        <p className="max-w-md text-base leading-relaxed text-[color:var(--color-ink-500)] sm:text-lg">
          {isPending
            ? t('processingBody')
            : t('successBody', {
                plan: t(`plans.${event.planTier!}` as const),
                days: event.planTier === 'premium' ? 180 : 30,
              })}
        </p>
        {isPending && reconciliationFailed ? (
          <p role="alert" className="text-sm text-[color:var(--color-destructive)]">
            {t('errors.reconciliation')}
          </p>
        ) : null}
        <Link
          href={`/events/${eventId}`}
          className={cn(buttonVariants({ variant: 'primary', size: 'lg' }), 'mt-4')}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('backToEvent')}
        </Link>
      </div>
    </AppShell>
  );
}
