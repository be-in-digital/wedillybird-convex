import type { Locale } from '../../../i18n/routing';
import { getServerTranslator } from '../../i18n/server-translator';
import type { EmailRendered } from '../types';
import { button, escapeHtml, htmlLayout, paragraph, paragraphRaw } from './_layout';

/** Une personne de la tablée, telle qu'on l'annonce dans le mail. */
export type SeatPassMemberInput = {
  fullName: string;
  tableName: string | null;
  seatNumber: number | null;
};

export type SeatPassInput = {
  guestName: string;
  coupleNames: string;
  eventDate: string;
  venueName: string | null;
  /** URL du pass placement (`/{locale}/i/{token}/place`). */
  seatUrl: string;
  members: SeatPassMemberInput[];
  /** Mot libre de l'organisateur, déjà tronqué côté Convex. */
  note: string | null;
  locale?: Locale | string;
};

/**
 * « Votre place à table » — mail envoyé après publication du plan.
 *
 * Le mail annonce la table (et la chaise si l'event est en numérotation
 * `seat`) **et** renvoie vers le pass, qui porte le plan de salle et le QR
 * code de check-in. On répète l'info en clair dans le corps pour que l'invité
 * l'ait même sans ouvrir le lien (et sans réseau le jour J).
 */
export function renderSeatPass(input: SeatPassInput): EmailRendered {
  const { guestName, coupleNames, eventDate, venueName, seatUrl, members, note, locale } = input;
  const t = getServerTranslator(locale);

  const subject = t('Emails.seatPass.subject', { coupleNames });

  const line = (m: SeatPassMemberInput): string => {
    if (!m.tableName) return t('Emails.seatPass.memberUnplaced', { name: m.fullName });
    if (m.seatNumber === null) {
      return t('Emails.seatPass.memberTable', { name: m.fullName, table: m.tableName });
    }
    return t('Emails.seatPass.memberSeat', {
      name: m.fullName,
      table: m.tableName,
      seat: m.seatNumber,
    });
  };

  const rows = members
    .map(
      (m) =>
        `<li style="margin:0 0 6px;font-size:15px;line-height:1.5;color:#2b2422;">${escapeHtml(
          line(m),
        )}</li>`,
    )
    .join('');

  const html = htmlLayout({
    preheader: t('Emails.seatPass.preheader', { coupleNames }),
    body:
      paragraph(t('Emails.common.greeting', { name: guestName })) +
      paragraph(
        venueName
          ? t('Emails.seatPass.introVenue', { coupleNames, eventDate, venue: venueName })
          : t('Emails.seatPass.intro', { coupleNames, eventDate }),
      ) +
      paragraphRaw(`<ul style="margin:0 0 16px;padding-left:20px;">${rows}</ul>`) +
      (note ? paragraph(note) : '') +
      paragraph(t('Emails.seatPass.callToAction')) +
      button(t('Emails.seatPass.ctaLabel'), seatUrl) +
      paragraph(t('Emails.seatPass.closing')),
    footer: t('Emails.seatPass.footer'),
    locale,
  });

  const text = [
    t('Emails.common.greeting', { name: guestName }),
    '',
    venueName
      ? t('Emails.seatPass.introVenue', { coupleNames, eventDate, venue: venueName })
      : t('Emails.seatPass.intro', { coupleNames, eventDate }),
    '',
    ...members.map((m) => `- ${line(m)}`),
    ...(note ? ['', note] : []),
    '',
    t('Emails.seatPass.callToAction'),
    seatUrl,
    '',
    t('Emails.seatPass.closing'),
    '',
    t('Emails.common.signature'),
  ].join('\n');

  return { subject, html, text };
}
