import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Users } from 'lucide-react';
import { requireProContext } from '@/lib/pro/require-pro-context';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { ModulePlaceholder } from '@/components/pro/module-placeholder';
import { ClientsBoard } from '@/components/pro/clients/clients-board';
import { effectiveProTier, tierHasFeature } from '@/lib/payments/entitlements';
import { nowMs } from '@/lib/pro/format';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ProPages');
  return { title: t('clientsMetaTitle') };
}

export default async function ProClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { session, org, user } = await requireProContext(locale);
  const t = await getTranslations('ProPages');
  // Palier EFFECTIF : un cadeau expiré ne doit pas laisser la fonctionnalité
  // ouverte, alors que `subscriptionTier` reste écrit sur l'organisation.
  const tier = effectiveProTier(org);
  const locked = !tierHasFeature(tier, 'crmPipeline');

  const shellOrg = {
    name: org.name,
    primaryColor: org.primaryColor,
    tier,
    role: org.myRole,
  };

  if (locked) {
    return (
      <ProSidebarShell current="clients" org={shellOrg} user={{ name: user?.fullName }}>
        <ModulePlaceholder
          eyebrow={t('clientsLockedEyebrow')}
          title={t('clientsTitle')}
          Icon={Users}
          description={t('clientsLockedDescription')}
          capabilities={[
            t('clientsCap1'),
            t('clientsCap2'),
            t('clientsCap3'),
            t('clientsCap4'),
            t('clientsCap5'),
            t('clientsCap6'),
          ]}
          lockedUntil="business"
        />
      </ProSidebarShell>
    );
  }

  const convex = getConvexServerClient();
  const [clients, members] = await Promise.all([
    convex.query(convexApi.clientsListByOrg, {
      organizationId: org._id,
      requesterId: session.userId,
    }),
    convex.query(convexApi.listOrgMembers, {
      organizationId: org._id,
      requesterId: session.userId,
    }),
  ]);

  const memberOptions = members
    .filter((m) => m.status === 'active' && m.userId && m.fullName)
    .map((m) => ({ _id: m.userId as string, name: m.fullName as string }));

  const canWrite = org.myRole !== 'viewer';

  return (
    <ProSidebarShell current="clients" org={shellOrg} user={{ name: user?.fullName }}>
      <ClientsBoard
        initialClients={clients}
        members={memberOptions}
        canWrite={canWrite}
        now={nowMs()}
        autoCreate={sp.new === '1'}
      />
    </ProSidebarShell>
  );
}
