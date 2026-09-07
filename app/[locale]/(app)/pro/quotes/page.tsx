import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FileText } from 'lucide-react';
import { requireProContext } from '@/lib/pro/require-pro-context';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { ModulePlaceholder } from '@/components/pro/module-placeholder';
import { QuotesBoard } from '@/components/pro/quotes/quotes-board';
import { effectiveProTier, tierHasFeature } from '@/lib/payments/entitlements';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ProPages');
  return { title: t('quotesMetaTitle') };
}

export default async function ProQuotesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { session, org, user } = await requireProContext(locale);
  const t = await getTranslations('ProPages');
  // Palier EFFECTIF : un cadeau expiré ne doit pas laisser la fonctionnalité
  // ouverte, alors que `subscriptionTier` reste écrit sur l'organisation.
  const tier = effectiveProTier(org);
  const locked = !tierHasFeature(tier, 'documentsEsign');

  const shellOrg = { name: org.name, primaryColor: org.primaryColor, tier, role: org.myRole };

  if (locked) {
    return (
      <ProSidebarShell current="quotes" org={shellOrg} user={{ name: user?.fullName }}>
        <ModulePlaceholder
          eyebrow={t('quotesLockedEyebrow')}
          title={t('quotesTitle')}
          Icon={FileText}
          description={t('quotesLockedDescription')}
          capabilities={[
            t('quotesCap1'),
            t('quotesCap2'),
            t('quotesCap3'),
            t('quotesCap4'),
            t('quotesCap5'),
            t('quotesCap6'),
          ]}
          lockedUntil="business"
        />
      </ProSidebarShell>
    );
  }

  const convex = getConvexServerClient();
  const [data, connect] = await Promise.all([
    convex.query(convexApi.quotesListByOrg, {
      organizationId: org._id,
      requesterId: session.userId,
    }),
    convex.query(convexApi.orgConnectStatus, {
      organizationId: org._id,
      requesterId: session.userId,
    }),
  ]);

  const canWrite = org.myRole !== 'viewer';
  const connected = connect.accountId != null;

  return (
    <ProSidebarShell current="quotes" org={shellOrg} user={{ name: user?.fullName }}>
      <QuotesBoard
        initialDocs={data.docs}
        clients={data.clients}
        weddings={data.weddings}
        organizationId={org._id}
        canWrite={canWrite}
        connected={connected}
      />
    </ProSidebarShell>
  );
}
