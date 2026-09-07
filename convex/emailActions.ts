'use node';

import { v } from 'convex/values';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalAction } from './_generated/server';
import {
  renderGuestReminder,
  renderLinkCode,
  renderMagicLink,
  renderNewsletterCampaign,
  renderProNotification,
  renderSeatPass,
  renderStripeInvoice,
  type ProNotificationKind,
} from '../lib/email/templates';
import type { EmailRendered } from '../lib/email/types';
import { signUnsubscribe } from '../lib/email/unsubscribe-token';
import { getServerTranslator } from '../lib/i18n/server-translator';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name} on Convex deployment`);
  return value;
}

let cachedSes: SESv2Client | null = null;
function sesClient(): SESv2Client {
  cachedSes ??= new SESv2Client({
    region: requireEnv('AWS_REGION'),
    credentials: {
      accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
    },
  });
  return cachedSes;
}

type DispatchOutcome = { ok: true; messageId: string } | { ok: false; error: string };

async function dispatch(to: string, rendered: EmailRendered): Promise<DispatchOutcome> {
  const driver = process.env.EMAIL_DRIVER ?? 'ses';

  // Mode E2E : force le mock même si SES est configuré côté env Convex. Idem
  // que pour WhatsApp (cf. `auth:requestOtp`) — évite l'envoi réel pendant
  // les tests Playwright.
  if (process.env.E2E_MODE === '1' || driver === 'mock') {
    const messageId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    console.log(`[email:mock] → ${to} | ${rendered.subject} | id=${messageId}`);
    return { ok: true, messageId };
  }

  const command = new SendEmailCommand({
    FromEmailAddress: requireEnv('SES_FROM_ADDRESS'),
    Destination: { ToAddresses: [to] },
    ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
    Content: {
      Simple: {
        Subject: { Data: rendered.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: rendered.html, Charset: 'UTF-8' },
          Text: { Data: rendered.text, Charset: 'UTF-8' },
        },
      },
    },
  });
  try {
    const response = await sesClient().send(command);
    return { ok: true, messageId: response.MessageId ?? 'unknown' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/* -------------------------------------------------------------------------- */
/*  Ops alerts (internes — pas de i18n, destinataire = équipe)                 */
/* -------------------------------------------------------------------------- */

/**
 * Alerte ops interne (ex. livraison SMS dégradée). Texte brut, non localisé
 * (destinataire = l'équipe, pas un client). Réutilise `dispatch` → SES, ou mock
 * en E2E. Best-effort : un échec est loggé, jamais propagé (ne casse pas le flux
 * appelant).
 */
export const sendOpsAlert = internalAction({
  args: { to: v.string(), subject: v.string(), body: v.string() },
  handler: async (_ctx, { to, subject, body }) => {
    const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rendered: EmailRendered = {
      subject,
      text: body,
      html: `<pre style="font-family:ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;font-size:14px">${escaped}</pre>`,
    };
    const outcome = await dispatch(to, rendered);
    if (!outcome.ok) console.error(`[ops-alert] send failed -> ${to}: ${outcome.error}`);
    return outcome;
  },
});

/* -------------------------------------------------------------------------- */
/*  Guest reminders                                                            */
/* -------------------------------------------------------------------------- */

export const sendGuestReminder = internalAction({
  args: {
    guestId: v.id('guests'),
    to: v.string(),
    guestName: v.string(),
    eventTitle: v.string(),
    eventDate: v.string(),
    invitationUrl: v.string(),
    daysUntilEvent: v.number(),
    tier: v.union(v.literal('d7'), v.literal('d1')),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rendered = renderGuestReminder({
      guestName: args.guestName,
      eventTitle: args.eventTitle,
      eventDate: args.eventDate,
      invitationUrl: args.invitationUrl,
      daysUntilEvent: args.daysUntilEvent,
      locale: args.locale,
    });
    const result = await dispatch(args.to, rendered);
    if (result.ok) {
      await ctx.runMutation(internal.guests.markReminderSent, {
        guestId: args.guestId,
        tier: args.tier,
      });
    } else {
      console.error(
        `[email] failed to send guest reminder ${args.tier} to ${args.to}: ${result.error}`,
      );
    }
    return result;
  },
});

/**
 * « Votre place à table » — envoyé quand l'organisateur publie (ou re-publie)
 * son plan de placement. Marque `guests.seatNotifiedAt` au succès pour que la
 * file d'envoi ne repropose pas l'invité tant que sa place ne bouge pas.
 */
export const sendSeatPass = internalAction({
  args: {
    guestId: v.id('guests'),
    to: v.string(),
    guestName: v.string(),
    coupleNames: v.string(),
    eventDate: v.string(),
    venueName: v.optional(v.string()),
    seatUrl: v.string(),
    members: v.array(
      v.object({
        fullName: v.string(),
        tableName: v.union(v.string(), v.null()),
        seatNumber: v.union(v.number(), v.null()),
      }),
    ),
    note: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rendered = renderSeatPass({
      guestName: args.guestName,
      coupleNames: args.coupleNames,
      eventDate: args.eventDate,
      venueName: args.venueName ?? null,
      seatUrl: args.seatUrl,
      members: args.members,
      note: args.note ?? null,
      locale: args.locale,
    });
    const result = await dispatch(args.to, rendered);
    if (result.ok) {
      await ctx.runMutation(internal.seatingGuest.markSeatNotified, {
        guestId: args.guestId,
        channel: 'email' as const,
      });
    } else {
      console.error(`[email] failed to send seat pass to ${args.to}: ${result.error}`);
    }
    return result;
  },
});

/* -------------------------------------------------------------------------- */
/*  Pro notifications (team member added, payment received, etc.)              */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  Magic Link email (fallback auth)                                           */
/* -------------------------------------------------------------------------- */

export const sendLinkCodeEmail = internalAction({
  args: {
    to: v.string(),
    code: v.string(),
    ipAddress: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (_ctx, { to, code, ipAddress, locale }) => {
    const rendered = renderLinkCode({
      code,
      expiresInMinutes: 10,
      requestIp: ipAddress,
      locale,
    });
    const result = await dispatch(to, rendered);
    if (!result.ok) {
      console.error(`[email] failed to send link code to ${to}: ${result.error}`);
    }
    return result;
  },
});

export const sendMagicLinkEmail = internalAction({
  args: {
    to: v.string(),
    token: v.string(),
    ipAddress: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (_ctx, { to, token, ipAddress, locale }) => {
    const baseUrl = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
    const verifyUrl = `${baseUrl.replace(/\/$/, '')}/api/auth/magic-link/verify?email=${encodeURIComponent(
      to,
    )}&token=${encodeURIComponent(token)}`;

    const rendered = renderMagicLink({
      verifyUrl,
      expiresInMinutes: 15,
      requestIp: ipAddress,
      locale,
    });
    const result = await dispatch(to, rendered);
    if (!result.ok) {
      console.error(`[email] failed to send magic link to ${to}: ${result.error}`);
    }
    return result;
  },
});

/**
 * Clé i18n pour bâtir le `detail` de la notification dynamiquement, en
 * respectant la locale du destinataire. Le mutation ne peut pas charger les
 * messages (Convex V8 isolate, pas d'import JSON), donc on passe la clé +
 * paramètres via les args et on traduit dans l'action Node.
 */
type ProDetailKey =
  | 'teamInviteDetail'
  | 'subscriptionWelcome'
  | 'subscriptionPastDue'
  | 'subscriptionCanceled'
  | 'subscriptionRenewedDetail'
  | 'paymentReceivedDetail'
  | 'paygCreditDetail';

const PRO_DETAIL_KEYS: readonly ProDetailKey[] = [
  'teamInviteDetail',
  'subscriptionWelcome',
  'subscriptionPastDue',
  'subscriptionCanceled',
  'subscriptionRenewedDetail',
  'paymentReceivedDetail',
  'paygCreditDetail',
];

const PRO_CTA_LABEL_KEYS = [
  'teamMemberAdded',
  'paymentReceived',
  'subscriptionRenewed',
  'subscriptionFailed',
  'paygCreditActivated',
] as const;

export const sendProNotification = internalAction({
  args: {
    to: v.string(),
    recipientName: v.string(),
    organizationName: v.string(),
    kind: v.union(
      v.literal('team-member-added'),
      v.literal('payment-received'),
      v.literal('subscription-renewed'),
      v.literal('subscription-failed'),
      v.literal('payg-credit-activated'),
      v.literal('photo-book-ordered'),
    ),
    /**
     * Détail pré-formaté. Optionnel — si absent, l'action utilise
     * `detailKey` + `detailVars` pour générer le détail traduit côté serveur.
     */
    detail: v.optional(v.string()),
    detailKey: v.optional(v.string()),
    detailVars: v.optional(v.any()),
    ctaLabel: v.optional(v.string()),
    /** Si fourni, override `ctaLabel` par la traduction de la clé Pro. */
    ctaLabelKey: v.optional(v.string()),
    ctaUrl: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const t = getServerTranslator(args.locale);
    let detail = args.detail ?? '';
    if (!detail && args.detailKey) {
      const key = args.detailKey as ProDetailKey;
      if (!PRO_DETAIL_KEYS.includes(key)) {
        throw new Error(`UNKNOWN_PRO_DETAIL_KEY:${key}`);
      }
      const vars = (args.detailVars ?? {}) as Record<string, string | number>;
      detail = t(`Emails.proNotification.${key}` as `Emails.proNotification.${ProDetailKey}`, vars);
    }
    let ctaLabel = args.ctaLabel;
    if (!ctaLabel && args.ctaLabelKey) {
      const labelKey = args.ctaLabelKey as (typeof PRO_CTA_LABEL_KEYS)[number];
      if (!(PRO_CTA_LABEL_KEYS as readonly string[]).includes(labelKey)) {
        throw new Error(`UNKNOWN_PRO_CTA_KEY:${labelKey}`);
      }
      ctaLabel = t(
        `Emails.proNotification.${labelKey}.ctaLabel` as 'Emails.proNotification.teamMemberAdded.ctaLabel',
      );
    }
    const rendered = renderProNotification({
      recipientName: args.recipientName,
      organizationName: args.organizationName,
      kind: args.kind as ProNotificationKind,
      detail,
      ctaLabel,
      ctaUrl: args.ctaUrl,
      locale: args.locale,
    });
    const result = await dispatch(args.to, rendered);
    if (!result.ok) {
      console.error(
        `[email] failed to send pro notification ${args.kind} to ${args.to}: ${result.error}`,
      );
    }
    return result;
  },
});

/* -------------------------------------------------------------------------- */
/*  Stripe invoice receipts                                                    */
/* -------------------------------------------------------------------------- */

export const sendStripeInvoice = internalAction({
  args: {
    to: v.string(),
    recipientName: v.string(),
    organizationName: v.string(),
    invoiceNumber: v.string(),
    amountFormatted: v.string(),
    periodLabel: v.string(),
    invoiceUrl: v.string(),
    pdfUrl: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const rendered = renderStripeInvoice({
      recipientName: args.recipientName,
      organizationName: args.organizationName,
      invoiceNumber: args.invoiceNumber,
      amountFormatted: args.amountFormatted,
      periodLabel: args.periodLabel,
      invoiceUrl: args.invoiceUrl,
      pdfUrl: args.pdfUrl,
      locale: args.locale,
    });
    const result = await dispatch(args.to, rendered);
    if (!result.ok) {
      console.error(
        `[email] failed to send stripe invoice ${args.invoiceNumber} to ${args.to}: ${result.error}`,
      );
    }
    return result;
  },
});

/* -------------------------------------------------------------------------- */
/*  Newsletter — envoi de campagne (admin)                                     */
/* -------------------------------------------------------------------------- */

function unsubscribeUrlFor(email: string): string {
  const baseUrl = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  const token = signUnsubscribe(email);
  return `${baseUrl.replace(/\/$/, '')}/api/newsletter/unsubscribe?email=${encodeURIComponent(
    email,
  )}&token=${token}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envoie une campagne newsletter via SES.
 *  - `testEmail` fourni → envoi de TEST à cette seule adresse (rien d'enregistré).
 *  - sinon → envoi à tous les abonnés actifs, enregistré dans `newsletterCampaigns`.
 *
 * Garde-fous : l'admin est revérifié (campaignContext), `dispatch` respecte
 * `E2E_MODE`/`EMAIL_DRIVER=mock` (aucun mail réel en test), throttle ~10/s pour
 * rester sous la limite SES. Chaque mail porte un lien de désinscription signé
 * + l'en-tête List-Unsubscribe (délivrabilité).
 */
type SendCampaignResult =
  | { ok: true; test: true; recipient: string }
  | {
      ok: true;
      test: false;
      campaignId: Id<'newsletterCampaigns'>;
      sentCount: number;
      failedCount: number;
    }
  | { ok: false; error: string };

export const sendNewsletterCampaign = action({
  args: {
    adminId: v.id('users'),
    subject: v.string(),
    bodyText: v.string(),
    testEmail: v.optional(v.string()),
  },
  // Type de retour explicite : casse l'inférence circulaire action ↔ internal API.
  handler: async (ctx, { adminId, subject, bodyText, testEmail }): Promise<SendCampaignResult> => {
    if (subject.trim().length === 0 || bodyText.trim().length === 0) {
      return { ok: false, error: 'EMPTY_CONTENT' };
    }

    // Revérifie le rôle admin + récupère le contexte (interne → non exposé).
    const context: { adminEmail: string | null; emails: string[] } = await ctx.runQuery(
      internal.newsletter.campaignContext,
      { adminId },
    );

    // --- Mode TEST : une seule adresse, rien d'enregistré.
    if (testEmail) {
      const rendered = renderNewsletterCampaign({
        subject,
        bodyText,
        unsubscribeUrl: unsubscribeUrlFor(testEmail),
      });
      const res = await dispatch(testEmail, rendered);
      return res.ok
        ? { ok: true, test: true, recipient: testEmail }
        : { ok: false, error: res.error };
    }

    // --- Envoi RÉEL à tous les abonnés actifs.
    const emails = context.emails;
    if (emails.length === 0) return { ok: false, error: 'NO_SUBSCRIBERS' };

    const campaignId: Id<'newsletterCampaigns'> = await ctx.runMutation(
      internal.newsletter.createCampaign,
      { adminId, subject, bodyText, totalRecipients: emails.length },
    );

    let sentCount = 0;
    let failedCount = 0;
    for (const email of emails) {
      const url = unsubscribeUrlFor(email);
      const rendered = renderNewsletterCampaign({ subject, bodyText, unsubscribeUrl: url });
      const res = await dispatch(email, rendered);
      if (res.ok) sentCount += 1;
      else failedCount += 1;
      await sleep(100); // ~10/s, sous la limite SES (14/s)
    }

    await ctx.runMutation(internal.newsletter.finalizeCampaign, {
      campaignId,
      sentCount,
      failedCount,
    });

    return { ok: true, test: false, campaignId, sentCount, failedCount };
  },
});
