import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { AppShell } from '@/components/app/app-shell';
import { PartnerDashboard } from '@/components/partner/partner-dashboard';

/**
 * Espace partenaire — ce que voit une créatrice qui recommande Wedillybird.
 *
 * Jusqu'ici le ledger d'affiliation n'était lisible QUE depuis `/admin`
 * (`assertAdmin`) : un partenaire n'avait aucun moyen de voir ses ventes ni ce
 * qui lui était dû, et le suivi retombait sur un récap manuel. Cette page rend
 * le ledger visible à son propriétaire, et à lui seul (`partnerDashboard` scope
 * la lecture sur `by_owner`).
 *
 * Réservée aux affiliés `kind: 'partner'` — la boucle de parrainage
 * particulier (crédit) reste dans l'espace couple (`ReferralCard`).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PartnerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const data = await convex.query(convexApi.partnerDashboard, { userId: session!.userId });
  // Pas partenaire = page inexistante (plutôt qu'une page vide qui révèle
  // l'existence du programme à qui n'y est pas).
  if (!data.isPartner) notFound();

  const t = await getTranslations('Partner');

  return (
    <AppShell>
      <div className="container-page flex flex-col gap-10 py-12 sm:py-16">
        <header className="flex flex-col gap-2">
          <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-gold-700)] uppercase">
            {t('eyebrow')}
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
            {t('title')}
          </h1>
          <p className="max-w-[60ch] text-sm text-[color:var(--color-ink-500)]">{t('subtitle')}</p>
        </header>

        <PartnerDashboard
          codes={data.codes}
          referrals={data.referrals}
          totals={data.totals}
          salesCount={data.salesCount}
        />

        {/* Les conditions du programme sont l'accord qui régit ces montants :
            le partenaire doit pouvoir les relire depuis l'endroit où il voit
            son dû, pas seulement au moment de son admission. */}
        <p className="text-xs text-[color:var(--color-ink-500)]">
          <Link
            href="/legal/affiliation"
            className="underline underline-offset-2 transition-colors hover:text-[color:var(--color-ink-900)]"
          >
            {t('termsLink')}
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
