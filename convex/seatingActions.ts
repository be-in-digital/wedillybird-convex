'use node';

import { v } from 'convex/values';
import { action } from './_generated/server';
import { internal } from './_generated/api';
import { sendWhatsAppCloudTemplate, isWhatsAppCloudConfigured } from './lib/whatsappCloud';
import { resolveChannel } from './lib/channelRouting';
import { isTwilioConfigured, sendTwilioSms } from './lib/twilioSms';
import { getSeatPassTemplateName } from '../lib/whatsapp/templates';
import { seatSummary, type SeatPassMember } from './lib/seatPass';
import { getServerTranslator } from '../lib/i18n/server-translator';

/**
 * Envoi des « pass placement » — l'étape qui suit la **validation** du plan par
 * l'organisateur (`seating.setSeatingPublication`).
 *
 * Routage canal identique aux invitations (`invitationActions.broadcast`) :
 *  - destinataire `+1` avec Twilio configuré → SMS,
 *  - sinon WhatsApp si le template Meta est validé (`WHATSAPP_SEAT_PASS_TEMPLATE`),
 *  - repli e-mail dès qu'aucun canal téléphone n'aboutit et qu'on a une adresse.
 *
 * **Idempotent** : ne cible que les invités que `listSeatPassRecipients` juge à
 * (re)notifier — jamais prévenus, ou placement modifié depuis le dernier envoi.
 * Relancer l'action juste après ne renvoie donc rien. `force: true` force le
 * renvoi intégral (l'organisateur assume le doublon).
 */

interface SeatBroadcastResult {
  sent: number;
  failed: number;
  skipped: number;
  total: number;
  mock: boolean;
  /** `true` si le template Meta n'est pas configuré (envois WhatsApp skippés). */
  whatsappUnavailable: boolean;
}

export const broadcastSeatPasses = action({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { eventId, requesterId, force }): Promise<SeatBroadcastResult> => {
    const event = await ctx.runQuery(internal.seatingGuest.getEventForSeatBroadcast, {
      eventId,
      requesterId,
    });
    if (!event) throw new Error('EVENT_NOT_FOUND_OR_FORBIDDEN');
    if (!event.hasSeating) throw new Error('FEATURE_NOT_IN_PLAN');
    // On n'envoie jamais un plan non validé : c'est la garantie donnée à
    // l'organisateur qu'un brouillon ne part pas tout seul.
    if (!event.publication.published) throw new Error('SEATING_NOT_PUBLISHED');

    const recipients = await ctx.runQuery(internal.seatingGuest.listSeatPassRecipients, {
      eventId,
      ...(force ? { force: true } : {}),
    });

    const templateName = getSeatPassTemplateName();
    const isMock = !isWhatsAppCloudConfigured();
    const empty: SeatBroadcastResult = {
      sent: 0,
      failed: 0,
      skipped: 0,
      total: recipients.length,
      mock: isMock,
      whatsappUnavailable: templateName === null,
    };
    if (recipients.length === 0) return empty;

    const locale = event.ownerLocale ?? 'fr';
    const t = getServerTranslator(locale);
    const coupleNames = `${event.coupleNames.partnerA} & ${event.coupleNames.partnerB}`;
    const eventDateFormatted = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: event.timezone,
    }).format(new Date(event.eventDate));
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com';
    const smsStatusCallbackUrl = `${appBaseUrl}/api/webhooks/twilio`;
    const numbering = event.publication.numbering;
    const note = event.publication.note ?? undefined;
    const venueName = event.venue?.name;

    const summaryLabels = {
      seatOne: (n: number) => t('SeatPass.summary.seatOne', { seat: n }),
      seatMany: (list: string) => t('SeatPass.summary.seatMany', { seats: list }),
      join: t('SeatPass.summary.join'),
    };

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const guest of recipients) {
      const firstName = guest.fullName.split(' ')[0] ?? guest.fullName;
      const members: SeatPassMember[] = guest.seats.map((s, i) => ({
        memberIndex: i,
        fullName: s.fullName,
        tableName: s.tableName,
        seatNumber: numbering === 'seat' ? s.seatNumber : null,
      }));
      const summary = seatSummary(members, numbering, summaryLabels);
      if (!summary) {
        skipped += 1;
        continue;
      }
      const seatUrl = `${appBaseUrl}/${locale}/i/${guest.qrCodeToken}/place`;

      // --- SMS (destinataires +1 quand Twilio est live) ---
      if (guest.phone && resolveChannel(guest.phone) === 'sms' && isTwilioConfigured()) {
        const smsResult = await sendTwilioSms({
          to: guest.phone,
          body: t('SeatPass.sms.body', { name: firstName, couple: coupleNames, seat: summary })
            .concat(` ${seatUrl}`)
            .concat(` ${t('SeatPass.sms.optOut')}`),
          statusCallback: smsStatusCallbackUrl,
        });
        if (!smsResult.ok) {
          console.error(`[seatPass] SMS failed for ${guest.phone}: ${smsResult.error}`);
          failed += 1;
          continue;
        }
        if (smsResult.mock) {
          console.info(`[twilio:mock] SEAT PASS -> ${guest.phone} | ${summary}`);
        }
        await ctx.runMutation(internal.seatingGuest.markSeatNotified, {
          guestId: guest._id,
          channel: 'sms' as const,
        });
        if (smsResult.messageId && !smsResult.mock) {
          await ctx.runMutation(internal.smsDeliveries.record, {
            twilioSid: smsResult.messageId,
            kind: 'invitation' as const,
            guestId: guest._id,
            eventId,
            to: guest.phone,
            status: 'sent' as const,
          });
        }
        sent += 1;
        continue;
      }

      // --- WhatsApp (canal par défaut hors +1), si le template Meta existe ---
      if (guest.phone && templateName) {
        const result = await sendWhatsAppCloudTemplate({
          to: guest.phone,
          templateName,
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: firstName },
                { type: 'text', text: coupleNames },
                { type: 'text', text: summary },
                { type: 'text', text: eventDateFormatted },
              ],
            },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              // Meta attend le suffixe de chemin, pas l'URL pleine.
              parameters: [{ type: 'text', text: `${guest.qrCodeToken}/place` }],
            },
          ],
        });
        if (result.ok) {
          if (result.mock) {
            console.info(`[whatsapp:mock] SEAT PASS -> ${guest.phone} | ${summary}`);
          }
          await ctx.runMutation(internal.seatingGuest.markSeatNotified, {
            guestId: guest._id,
            channel: 'whatsapp' as const,
          });
          sent += 1;
          continue;
        }
        console.error(`[seatPass] WhatsApp failed for ${guest.phone}: ${result.error}`);
        // Pas de `continue` : on tente l'e-mail plutôt que de perdre l'invité.
      }

      // --- Repli e-mail ---
      if (guest.email) {
        const emailResult = await ctx.runAction(internal.emailActions.sendSeatPass, {
          guestId: guest._id,
          to: guest.email,
          guestName: firstName,
          coupleNames,
          eventDate: eventDateFormatted,
          ...(venueName ? { venueName } : {}),
          seatUrl,
          members: members.map((m) => ({
            fullName: m.fullName,
            tableName: m.tableName,
            seatNumber: m.seatNumber,
          })),
          ...(note ? { note } : {}),
          locale,
        });
        if (emailResult.ok) {
          sent += 1;
        } else {
          failed += 1;
        }
        continue;
      }

      // Ni téléphone exploitable ni e-mail : l'organisateur devra transmettre
      // le lien à la main (l'UI liste ces invités).
      skipped += 1;
    }

    return {
      sent,
      failed,
      skipped,
      total: recipients.length,
      mock: isMock,
      whatsappUnavailable: templateName === null,
    };
  },
});
