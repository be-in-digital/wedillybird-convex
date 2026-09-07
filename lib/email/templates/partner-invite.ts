import type { Locale } from '../../../i18n/routing';
import { getServerTranslator } from '../../i18n/server-translator';
import type { EmailRendered } from '../types';
import { button, escapeHtml, htmlLayout, paragraph } from './_layout';

export interface PartnerInviteInput {
  /** URL absolue `/rejoindre/<token>` qui ouvre le compte offert. */
  inviteUrl: string;
  /** Prénom ou nom du partenaire, si connu — sinon salutation neutre. */
  inviteeName?: string;
  /** Durée du compte offert, en mois. */
  grantMonths: number;
  /** Code d'affiliation déjà actif sur le compte créé. */
  affiliateCode?: string;
  /** Échéance du LIEN (pas du compte), en millisecondes epoch. */
  expiresAt: number;
  locale?: Locale | string;
}

/**
 * E-mail d'invitation partenaire.
 *
 * Il porte deux durées qu'il ne faut surtout pas confondre, et que le message
 * sépare explicitement : le **lien** expire sous quelques semaines, le
 * **compte** qu'il ouvre est offert plusieurs mois. Les mélanger ferait croire
 * à un partenaire qu'il ne lui reste que dix jours d'essai.
 *
 * Il dit aussi ce que l'offre ne demande pas — aucune carte bancaire — parce
 * que c'est précisément la question qui retient quelqu'un de cliquer.
 */
export function renderPartnerInvite({
  inviteUrl,
  inviteeName,
  grantMonths,
  affiliateCode,
  expiresAt,
  locale,
}: PartnerInviteInput): EmailRendered {
  const t = getServerTranslator(locale);
  const expiryDate = new Intl.DateTimeFormat(typeof locale === 'string' ? locale : 'fr', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(expiresAt));

  const subject = t('Emails.partnerInvite.subject', { months: grantMonths });
  const preheader = t('Emails.partnerInvite.preheader', { months: grantMonths });

  const body = [
    paragraph(
      inviteeName
        ? // Pas d'`escapeHtml` ici : le traducteur échappe déjà les valeurs
          // interpolées, et pré-échapper produisait `&amp;lt;` au lieu de `&lt;`.
          t('Emails.common.greeting', { name: inviteeName })
        : t('Emails.common.greetingSimple'),
    ),
    paragraph(t('Emails.partnerInvite.intro', { months: grantMonths })),
    paragraph(t('Emails.partnerInvite.noCard')),
    button(t('Emails.partnerInvite.ctaLabel', { months: grantMonths }), inviteUrl),
    paragraph(t('Emails.common.fallbackLink')),
    `<p style="margin:0 0 16px 0;word-break:break-all;font-size:13px;color:#666;">${escapeHtml(inviteUrl)}</p>`,
    // Le lien expire, pas l'offre : dit séparément pour éviter la confusion.
    paragraph(t('Emails.partnerInvite.linkExpiry', { date: expiryDate })),
    affiliateCode ? paragraph(t('Emails.partnerInvite.codeNotice', { code: affiliateCode })) : '',
  ].join('');

  const footer = [t('Emails.common.tagline'), t('Emails.common.supportFooter')]
    .map((line) => `<p style="margin:0 0 4px 0;">${line}</p>`)
    .join('');

  const html = htmlLayout({ preheader, body, footer, locale });

  const text = [
    subject,
    '',
    t('Emails.partnerInvite.intro', { months: grantMonths }),
    t('Emails.partnerInvite.noCard'),
    '',
    inviteUrl,
    '',
    t('Emails.partnerInvite.linkExpiry', { date: expiryDate }),
    affiliateCode ? t('Emails.partnerInvite.codeNotice', { code: affiliateCode }) : '',
    '',
    t('Emails.common.signature'),
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}
