import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OG_DEFAULT_IMAGES } from '@/lib/seo/og';
import { toOgLocale } from '@/lib/i18n/locale-tags';
import { EditorialPage, EditorialSection } from '@/components/marketing/editorial-page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Metadata.legalAffiliation' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: '/legal/affiliation' },
    openGraph: {
      type: 'article',
      title: t('title'),
      description: t('description'),
      url: '/legal/affiliation',
      siteName: 'Wedillybird',
      locale: toOgLocale(locale),
      images: [...OG_DEFAULT_IMAGES],
    },
  };
}

/**
 * Conditions du programme partenaire (affiliation).
 *
 * Page PUBLIQUE et indexable, bien que le programme soit sur invitation : une
 * créatrice doit pouvoir lire les conditions AVANT d'accepter, alors qu'elle
 * n'a pas encore de compte. L'espace partenaire y renvoie une fois admise.
 *
 * Chaque article décrit ce que le système fait RÉELLEMENT — fenêtre
 * d'attribution de 30 j (`proxy.ts`), acquisition à la date du mariage avec
 * plancher J+7 (`convex/lib/affiliate.ts:vestsAt`), plafond de cumul remise +
 * commission à 25 % (`MAX_COMBINED_BPS`), restriction du code aux forfaits
 * couple (`resolveConsumerPlanProductIds`). Toute évolution de ces règles côté
 * code doit être répercutée ici : des conditions que le système ne tient pas
 * sont pires que pas de conditions du tout.
 */
export default async function AffiliationTermsPage() {
  const t = await getTranslations('Legal.affiliation');
  const tm = await getTranslations('Marketing.legal');
  return (
    <EditorialPage eyebrow={tm('eyebrow')} title={t('title')} lastUpdated={t('lastUpdated')}>
      <EditorialSection title={t('article1Title')} body={t('article1Body')} />
      <EditorialSection title={t('article2Title')} body={t('article2Body')} />
      <EditorialSection title={t('article3Title')} body={t('article3Body')} />
      <EditorialSection title={t('article4Title')} body={t('article4Body')} />
      <EditorialSection title={t('article5Title')} body={t('article5Body')} />
      <EditorialSection title={t('article6Title')} body={t('article6Body')} />
      <EditorialSection title={t('article7Title')} body={t('article7Body')} />
      <EditorialSection title={t('article8Title')} body={t('article8Body')} />
      <EditorialSection title={t('article9Title')} body={t('article9Body')} />
      <EditorialSection title={t('article10Title')} body={t('article10Body')} />
      <EditorialSection title={t('article11Title')} body={t('article11Body')} />
    </EditorialPage>
  );
}
