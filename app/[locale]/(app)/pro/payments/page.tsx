import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Banknote } from 'lucide-react';
import { requireProContext } from '@/lib/pro/require-pro-context';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { ModulePlaceholder } from '@/components/pro/module-placeholder';
import { PaymentsBoard } from '@/components/pro/payments/payments-board';
import { StripeConnectCard } from '@/components/pro/stripe-connect-card';
import { effectiveProTier, tierHasFeature } from '@/lib/payments/entitlements';
import { nowMs } from '@/lib/pro/format';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ProPages');
  return { title: t('paymentsMetaTitle') };
}

export default async function ProPaymentsPage({ params }: { params: Promise<{ locale: string }> }) {
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
      <ProSidebarShell current="payments" org={shellOrg} user={{ name: user?.fullName }}>
        <ModulePlaceholder
          eyebrow={t('paymentsLockedEyebrow')}
          title={t('paymentsTitle')}
          Icon={Banknote}
          description={t('paymentsLockedDescription')}
          capabilities={[
            t('paymentsCap1'),
            t('paymentsCap2'),
            t('paymentsCap3'),
            t('paymentsCap4'),
            t('paymentsCap5'),
          ]}
          lockedUntil="business"
        />
      </ProSidebarShell>
    );
  }

  const convex = getConvexServerClient();
  const [data, connect] = await Promise.all([
    convex.query(convexApi.paymentsOverview, {
      organizationId: org._id,
      requesterId: session.userId,
    }),
    convex.query(convexApi.orgConnectStatus, {
      organizationId: org._id,
      requesterId: session.userId,
    }),
  ]);
  const canWrite = org.myRole !== 'viewer';
  const canManage = org.myRole === 'owner' || org.myRole === 'admin';

  return (
    <ProSidebarShell current="payments" org={shellOrg} user={{ name: user?.fullName }}>
      <div className="container-page flex flex-col gap-6 py-8 sm:py-10">
        <StripeConnectCard status={connect} canManage={canManage} />
      </div>
      <PaymentsBoard
        invoices={data.invoices}
        account={data.account}
        canWrite={canWrite}
        canManage={canManage}
        now={nowMs()}
      />
    </ProSidebarShell>
  );
}
