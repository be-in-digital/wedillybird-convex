import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OG_DEFAULT_IMAGES } from '@/lib/seo/og';
import { toOgLocale } from '@/lib/i18n/locale-tags';
import { EditorialPage, EditorialSection } from '@/components/marketing/editorial-page';
import { HOST_PROVIDER, LEGAL_ENTITY, formatSiren, formatSiret } from '@/lib/legal/entity';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Metadata.legalMentions' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: '/legal/mentions' },
    openGraph: {
      type: 'article',
      title: t('title'),
      description: t('description'),
      url: '/legal/mentions',
      siteName: 'Wedillybird',
      locale: toOgLocale(locale),
      images: [...OG_DEFAULT_IMAGES],
    },
  };
}

/**
 * Mentions légales.
 *
 * L'identité vient de `lib/legal/entity.ts`, jamais des fichiers de messages :
 * un SIREN ne se traduit pas, et le dupliquer dans sept locales, ce serait sept
 * endroits à corriger et sept occasions d'en oublier un. Les fichiers i18n ne
 * portent ici que des LIBELLÉS.
 *
 * Les mentions encore inconnues sont **omises**, jamais remplies d'un gabarit :
 * une ligne absente se corrige, une ligne « à compléter » sur une page publique
 * décrédibilise tout le reste. `pendingLegalFields()` énumère ce qui manque, et
 * un test verrouille cette liste pour qu'elle ne s'oublie pas.
 */
export default async function LegalNoticePage() {
  const t = await getTranslations('Legal.mentions');
  const tm = await getTranslations('Marketing.legal');

  const publisher = [
    LEGAL_ENTITY.legalForm
      ? `${LEGAL_ENTITY.legalName} — ${LEGAL_ENTITY.legalForm}`
      : LEGAL_ENTITY.legalName,
    t('tradeName', { value: LEGAL_ENTITY.tradeName }),
    LEGAL_ENTITY.shareCapitalMinor !== null
      ? t('capital', { value: (LEGAL_ENTITY.shareCapitalMinor / 100).toLocaleString('fr-FR') })
      : null,
    ...(LEGAL_ENTITY.registeredAddress ?? []),
    LEGAL_ENTITY.siret
      ? t('siret', { value: formatSiret(LEGAL_ENTITY.siret) })
      : t('siren', { value: formatSiren(LEGAL_ENTITY.siren) }),
    LEGAL_ENTITY.rcsCity
      ? t('rcs', { city: LEGAL_ENTITY.rcsCity, value: formatSiren(LEGAL_ENTITY.siren) })
      : null,
    t('vat', { value: LEGAL_ENTITY.vatNumber }),
    t('contact', { value: LEGAL_ENTITY.contactEmail }),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  return (
    <EditorialPage eyebrow={tm('eyebrow')} title={t('title')} lastUpdated={t('lastUpdated')}>
      <EditorialSection title={t('publisherTitle')} body={publisher} />
      {LEGAL_ENTITY.publicationDirector ? (
        <EditorialSection
          title={t('directorTitle')}
          body={t('directorBody', { name: LEGAL_ENTITY.publicationDirector })}
        />
      ) : null}
      <EditorialSection
        title={t('hostTitle')}
        body={t('hostBody', { name: HOST_PROVIDER.name, url: HOST_PROVIDER.url })}
      />
      <EditorialSection title={t('ipTitle')} body={t('ipBody')} />
      <EditorialSection title={t('dataTitle')} body={t('dataBody')} />
      <EditorialSection title={t('cookiesTitle')} body={t('cookiesBody')} />
      {LEGAL_ENTITY.consumerMediator ? (
        <EditorialSection
          title={t('mediationTitle')}
          body={t('mediationBody', {
            name: LEGAL_ENTITY.consumerMediator.name,
            url: LEGAL_ENTITY.consumerMediator.url,
          })}
        />
      ) : null}
    </EditorialPage>
  );
}
