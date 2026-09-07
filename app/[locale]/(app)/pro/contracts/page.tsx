import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FileSignature } from 'lucide-react';
import { requireProContext } from '@/lib/pro/require-pro-context';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { ModulePlaceholder } from '@/components/pro/module-placeholder';
import { ContractsBoard } from '@/components/pro/contracts/contracts-board';
import { effectiveProTier, tierHasFeature } from '@/lib/payments/entitlements';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ProPages');
  return { title: t('contractsMetaTitle') };
}

export default async function ProContractsPage({
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
  const locked = !tierHasFeature(tier, 'documentsEsign');
  const shellOrg = { name: org.name, primaryColor: org.primaryColor, tier, role: org.myRole };

  if (locked) {
    return (
      <ProSidebarShell current="contracts" org={shellOrg} user={{ name: user?.fullName }}>
        <ModulePlaceholder
          eyebrow={t('contractsLockedEyebrow')}
          title={t('contractsTitle')}
          Icon={FileSignature}
          description={t('contractsLockedDescription')}
          capabilities={[
            t('contractsCap1'),
            t('contractsCap2'),
            t('contractsCap3'),
            t('contractsCap4'),
            t('contractsCap5'),
          ]}
          lockedUntil="business"
        />
      </ProSidebarShell>
    );
  }

  const convex = getConvexServerClient();
  const data = await convex.query(convexApi.contractsListByOrg, {
    organizationId: org._id,
    requesterId: session.userId,
  });
  const canWrite = org.myRole !== 'viewer';

  return (
    <ProSidebarShell current="contracts" org={shellOrg} user={{ name: user?.fullName }}>
      <ContractsBoard
        initialContracts={data.contracts}
        clients={data.clients}
        weddings={data.weddings}
        organizationId={org._id}
        orgName={org.name}
        plannerName={user?.fullName ?? org.name}
        brandColor={org.primaryColor ?? 'oklch(48% 0.085 22)'}
        canWrite={canWrite}
      />
    </ProSidebarShell>
  );
}
