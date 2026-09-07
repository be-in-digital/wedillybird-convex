import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Plug, Zap, Code2, Workflow, ArrowDownToLine } from 'lucide-react';
import { requireProContext } from '@/lib/pro/require-pro-context';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { ModulePlaceholder } from '@/components/pro/module-placeholder';
import { CsvImport } from '@/components/pro/integrations/csv-import';
import { effectiveProTier, tierHasFeature } from '@/lib/payments/entitlements';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ProPages');
  return { title: t('integrationsMetaTitle') };
}

export default async function ProIntegrationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { session, org, user } = await requireProContext(locale);
  const t = await getTranslations('ProPages');
  const connectors: ReadonlyArray<{ name: string; desc: string; Icon: typeof Zap }> = [
    {
      name: 'HoneyBook',
      desc: t('integrationsConnectorHoneybookDesc'),
      Icon: ArrowDownToLine,
    },
    { name: 'Zapier / Make', desc: t('integrationsConnectorZapierDesc'), Icon: Workflow },
    {
      name: 'API & Webhooks',
      desc: t('integrationsConnectorApiDesc'),
      Icon: Code2,
    },
  ];
  // Palier EFFECTIF : un cadeau expiré ne doit pas laisser la fonctionnalité
  // ouverte, alors que `subscriptionTier` reste écrit sur l'organisation.
  const tier = effectiveProTier(org);
  const canImport = tierHasFeature(tier, 'crmPipeline'); // Business+
  const shellOrg = { name: org.name, primaryColor: org.primaryColor, tier, role: org.myRole };

  if (!canImport) {
    return (
      <ProSidebarShell current="integrations" org={shellOrg} user={{ name: user?.fullName }}>
        <ModulePlaceholder
          eyebrow={t('integrationsLockedEyebrow')}
          title={t('integrationsTitle')}
          Icon={Plug}
          description={t('integrationsLockedDescription')}
          capabilities={[
            t('integrationsCap1'),
            t('integrationsCap2'),
            t('integrationsCap3'),
            t('integrationsCap4'),
            t('integrationsCap5'),
          ]}
          lockedUntil="business"
        />
      </ProSidebarShell>
    );
  }

  const convex = getConvexServerClient();
  const clients = await convex.query(convexApi.clientsListByOrg, {
    organizationId: org._id,
    requesterId: session.userId,
  });
  const existingNames = clients.map((c) => c.partnerA);

  return (
    <ProSidebarShell current="integrations" org={shellOrg} user={{ name: user?.fullName }}>
      <div className="container-page flex flex-col gap-6 py-8 sm:py-10">
        <header className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-muted-foreground)] uppercase">
            {t('integrationsHeaderEyebrow')}
          </span>
          <h1
            className="font-display italic"
            style={{
              fontSize: 'clamp(1.9rem, 4vw, 2.75rem)',
              lineHeight: 1.05,
              letterSpacing: '-0.022em',
              color: 'var(--color-foreground)',
            }}
          >
            {t('integrationsHeaderTitle')}
          </h1>
        </header>

        <CsvImport existingNames={existingNames} />

        {/* Connecteurs (roadmap — nécessitent des identifiants externes) */}
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10px] tracking-[0.16em] text-[color:var(--color-muted-foreground)] uppercase">
            {t('integrationsConnectorsHeading')}
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {connectors.map((c) => (
              <div
                key={c.name}
                className="flex flex-col gap-2 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4"
              >
                <span className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--color-surface-elevated)] text-[color:var(--color-blush-300)]">
                    <c.Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
                  </span>
                  <span className="rounded-full border border-[color:var(--color-border)] px-2 py-0.5 font-mono text-[9px] tracking-[0.14em] text-[color:var(--color-muted-foreground)] uppercase">
                    {t('integrationsSoonBadge')}
                  </span>
                </span>
                <span className="font-medium text-[color:var(--color-foreground)]">{c.name}</span>
                <span className="text-xs text-[color:var(--color-muted-foreground)]">{c.desc}</span>
              </div>
            ))}
          </div>
          <p className="font-mono text-[10px] text-[color:var(--color-muted-foreground)]">
            {t('integrationsConnectorsFootnote')}
          </p>
        </section>
      </div>
    </ProSidebarShell>
  );
}
