/**
 * Double de `convex/emailActions.ts` pour le backend Convex en mémoire.
 *
 * Le vrai module porte `'use node'` (SDK AWS SES) : `convex-test` ne sait pas
 * l'exécuter. Ce double expose **exactement les mêmes exports**, avec les mêmes
 * types d'enregistrement (`action` vs `internalAction`) et les mêmes
 * validateurs d'arguments, mais remplace l'appel SES par un enregistrement en
 * mémoire lisible via `GET /__test__/emails`.
 *
 * Deux invariants à préserver si le vrai module bouge :
 *  - la CONSTRUCTION des URLs (magic link, invitation partenaire) doit rester
 *    identique : les tests navigateur extraient ces liens du HTML capturé ;
 *  - les effets de bord en base (`markReminderSent`, `markSent`, campagne
 *    newsletter) doivent rester les mêmes, sinon les parcours testés divergent
 *    de la prod.
 *
 * Fichier de test uniquement : rien en `app/`, `lib/` ou `convex/` ne l'importe.
 */
import { v } from 'convex/values';
import { internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { action, internalAction } from '../../../convex/_generated/server';
import {
  renderGuestReminder,
  renderLinkCode,
  renderMagicLink,
  renderNewsletterCampaign,
  renderPartnerInvite,
  renderProNotification,
  renderStripeInvoice,
  type ProNotificationKind,
} from '../../../lib/email/templates';
import type { EmailRendered } from '../../../lib/email/types';
import { signUnsubscribe } from '../../../lib/email/unsubscribe-token';
import { getServerTranslator } from '../../../lib/i18n/server-translator';
import { LEGAL_ENTITY } from '../../../lib/legal/entity';

/* -------------------------------------------------------------------------- */
/*  Boîte d'envoi en mémoire                                                   */
/* -------------------------------------------------------------------------- */

export type CapturedEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  sentAt: number;
};

/**
 * Stockée sur `globalThis` et pas dans un `const` de module : le serveur HTTP
 * importe ce fichier statiquement, `convex-test` le ré-importe dynamiquement
 * via la map de modules. Deux instanciations du module donneraient deux
 * tableaux, et `/__test__/emails` renverrait toujours vide.
 */
const OUTBOX_KEY = '__wbbConvexMemOutbox__';

function outbox(): CapturedEmail[] {
  const g = globalThis as typeof globalThis & { [OUTBOX_KEY]?: CapturedEmail[] };
  g[OUTBOX_KEY] ??= [];
  return g[OUTBOX_KEY];
}

/** Copie des e-mails capturés, du plus ancien au plus récent. */
export function readEmails(): CapturedEmail[] {
  return [...outbox()];
}

/** Vide la boîte d'envoi ; renvoie le nombre d'entrées supprimées. */
export function clearEmails(): number {
  const box = outbox();
  const n = box.length;
  box.length = 0;
  return n;
}

type DispatchOutcome = { ok: true; messageId: string } | { ok: false; error: string };

/** Remplace `dispatch()` du vrai module : capture au lieu d'appeler SES. */
function dispatch(
  to: string,
  rendered: EmailRendered,
  options: { replyTo?: string } = {},
): DispatchOutcome {
  outbox().push({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    sentAt: Date.now(),
  });
  return {
    ok: true,
    messageId: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

function baseUrl(): string {
  const url = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  return url.replace(/\/$/, '');
}

/* -------------------------------------------------------------------------- */
/*  Ops alerts                                                                 */
/* -------------------------------------------------------------------------- */

export const sendOpsAlert = internalAction({
  args: { to: v.string(), subject: v.string(), body: v.string() },
  handler: async (_ctx, { to, subject, body }) => {
    const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return dispatch(to, {
      subject,
      text: body,
      html: `<pre style="font-family:ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;font-size:14px">${escaped}</pre>`,
    });
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
    const result = dispatch(args.to, rendered);
    if (result.ok) {
      await ctx.runMutation(internal.guests.markReminderSent, {
        guestId: args.guestId,
        tier: args.tier,
      });
    }
    return result;
  },
});

/* -------------------------------------------------------------------------- */
/*  Auth — code de liaison et magic link                                       */
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
    return dispatch(to, rendered);
  },
});

export const sendMagicLinkEmail = internalAction({
  args: {
    to: v.string(),
    token: v.string(),
    ipAddress: v.optional(v.string()),
    locale: v.optional(v.string()),
    next: v.optional(v.string()),
  },
  handler: async (_ctx, { to, token, ipAddress, locale, next }) => {
    // Doit rester copie conforme du vrai module : les tests navigateur suivent
    // ce lien tel quel.
    const verifyUrl = `${baseUrl()}/api/auth/magic-link/verify?email=${encodeURIComponent(
      to,
    )}&token=${encodeURIComponent(token)}${next ? `&next=${encodeURIComponent(next)}` : ''}`;

    const rendered = renderMagicLink({
      verifyUrl,
      expiresInMinutes: 15,
      requestIp: ipAddress,
      locale,
    });
    return dispatch(to, rendered);
  },
});

/* -------------------------------------------------------------------------- */
/*  Invitation partenaire (action PUBLIQUE dans le vrai module)                */
/* -------------------------------------------------------------------------- */

export const sendPartnerInvite = action({
  args: {
    adminId: v.id('users'),
    inviteId: v.id('partnerInvites'),
    to: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { adminId, inviteId, to, locale },
  ): Promise<{ ok: true; to: string } | { ok: false; error: string }> => {
    const prepared: {
      recipient: string;
      kind: 'pro' | 'couple';
      token: string;
      inviteeName: string | null;
      grantMonths: number;
      expiresAt: number;
      affiliateCode: string;
    } = await ctx.runQuery(internal.partnerInvites.prepareSend, { adminId, inviteId, to });

    const inviteUrl = `${baseUrl()}/rejoindre/${prepared.token}`;

    const rendered = renderPartnerInvite({
      inviteUrl,
      kind: prepared.kind,
      inviteeName: prepared.inviteeName ?? undefined,
      grantMonths: prepared.grantMonths,
      affiliateCode: prepared.affiliateCode,
      expiresAt: prepared.expiresAt,
      locale,
    });

    const result = dispatch(prepared.recipient, rendered, { replyTo: LEGAL_ENTITY.contactEmail });
    if (!result.ok) return { ok: false as const, error: result.error };

    await ctx.runMutation(internal.partnerInvites.markSent, {
      inviteId,
      to: prepared.recipient,
    });
    return { ok: true as const, to: prepared.recipient };
  },
});

/* -------------------------------------------------------------------------- */
/*  Notifications pro                                                          */
/* -------------------------------------------------------------------------- */

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
    detail: v.optional(v.string()),
    detailKey: v.optional(v.string()),
    detailVars: v.optional(v.any()),
    ctaLabel: v.optional(v.string()),
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
    return dispatch(args.to, rendered);
  },
});

/* -------------------------------------------------------------------------- */
/*  Facture Stripe                                                             */
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
    return dispatch(args.to, rendered);
  },
});

/* -------------------------------------------------------------------------- */
/*  Campagne newsletter (action PUBLIQUE dans le vrai module)                  */
/* -------------------------------------------------------------------------- */

function unsubscribeUrlFor(email: string): string {
  const token = signUnsubscribe(email);
  return `${baseUrl()}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

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
  handler: async (ctx, { adminId, subject, bodyText, testEmail }): Promise<SendCampaignResult> => {
    if (subject.trim().length === 0 || bodyText.trim().length === 0) {
      return { ok: false, error: 'EMPTY_CONTENT' };
    }

    const context: { adminEmail: string | null; emails: string[] } = await ctx.runQuery(
      internal.newsletter.campaignContext,
      { adminId },
    );

    if (testEmail) {
      const rendered = renderNewsletterCampaign({
        subject,
        bodyText,
        unsubscribeUrl: unsubscribeUrlFor(testEmail),
      });
      const res = dispatch(testEmail, rendered);
      return res.ok
        ? { ok: true, test: true, recipient: testEmail }
        : { ok: false, error: res.error };
    }

    const emails = context.emails;
    if (emails.length === 0) return { ok: false, error: 'NO_SUBSCRIBERS' };

    const campaignId: Id<'newsletterCampaigns'> = await ctx.runMutation(
      internal.newsletter.createCampaign,
      { adminId, subject, bodyText, totalRecipients: emails.length },
    );

    let sentCount = 0;
    let failedCount = 0;
    for (const email of emails) {
      const rendered = renderNewsletterCampaign({
        subject,
        bodyText,
        unsubscribeUrl: unsubscribeUrlFor(email),
      });
      // Pas de throttle ici (le vrai module dort 100 ms/mail pour SES) : en
      // test on veut le résultat tout de suite.
      if (dispatch(email, rendered).ok) sentCount += 1;
      else failedCount += 1;
    }

    await ctx.runMutation(internal.newsletter.finalizeCampaign, {
      campaignId,
      sentCount,
      failedCount,
    });

    return { ok: true, test: false, campaignId, sentCount, failedCount };
  },
});
