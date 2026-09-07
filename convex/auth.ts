import { v } from 'convex/values';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  MAGIC_LINK_EXPIRY_MS,
  MAGIC_LINK_RATE_WINDOW_MS,
  MAX_MAGIC_LINKS_PER_HOUR,
  generateMagicToken,
  hashMagicToken,
  verifyMagicTokenHash,
} from './lib/magicLink';
import {
  MAX_ATTEMPTS,
  MAX_OTP_PER_HOUR,
  OTP_EXPIRY_MS,
  RATE_WINDOW_MS,
  generateOtpCode,
  hashOtp,
  verifyOtpHash,
} from './lib/otp';
import { isValidE164, normalizePhone } from './lib/phone';
import { sendWhatsAppCloudTemplate } from './lib/whatsappCloud';
import { resolveChannel } from './lib/channelRouting';
import { isTwilioConfigured, sendTwilioSms } from './lib/twilioSms';
import { isValidEmail, normalizeEmail } from './lib/email';
import { matchesConfiguredAdmin } from './lib/adminPromotion';
import { isSuspended } from './lib/accountStatus';

export const requestOtp = action({
  args: {
    phone: v.string(),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, { phone, ipAddress }) => {
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidE164(normalized)) {
      throw new Error('INVALID_PHONE');
    }

    const rateOk = await ctx.runQuery(internal.auth._checkRate, {
      phone: normalized,
    });
    if (!rateOk) {
      throw new Error('RATE_LIMITED');
    }

    // Demo bypass — uniquement actif si DEMO_BYPASS_PHONE et DEMO_BYPASS_CODE
    // sont tous deux définis côté Convex ET que le téléphone matche exactement.
    // Permet à un designer / contractor externe de filmer la démo sans recevoir
    // d'OTP WhatsApp réel. Ne JAMAIS définir ces env vars sur le déploiement prod.
    const demoPhone = process.env.DEMO_BYPASS_PHONE;
    const demoCode = process.env.DEMO_BYPASS_CODE;
    if (demoPhone && demoCode && normalized === demoPhone) {
      if (!/^\d{6}$/.test(demoCode)) {
        throw new Error('INVALID_DEMO_CODE');
      }
      const codeHash = await hashOtp(demoCode, normalized);
      await ctx.runMutation(internal.auth._saveOtpSession, {
        phone: normalized,
        codeHash,
        ipAddress,
      });
      console.info(`[auth:demo-bypass] OTP session issued for ${normalized}`);
      return { phone: normalized, channel: 'whatsapp' as const, provider: 'demo_bypass' as const };
    }

    const code = generateOtpCode();
    const codeHash = await hashOtp(code, normalized);

    // Routage canal par pays (cf. convex/lib/channelRouting.ts) : US/Canada
    // (+1) → SMS Twilio, reste du monde → WhatsApp. On ne bascule réellement
    // sur SMS que si Twilio est configuré ; sinon on retombe sur WhatsApp
    // (comportement historique), garantissant zéro régression tant que le
    // numéro Twilio + la Toll-Free Verification ne sont pas en place.
    const channel: 'sms' | 'whatsapp' =
      resolveChannel(normalized) === 'sms' && isTwilioConfigured() ? 'sms' : 'whatsapp';

    await ctx.runMutation(internal.auth._saveOtpSession, {
      phone: normalized,
      codeHash,
      channel,
      ipAddress,
    });

    if (channel === 'sms') {
      const brand = process.env.SMS_BRAND_NAME ?? 'Wedillybird';
      const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com';
      const smsResult = await sendTwilioSms({
        to: normalized,
        body: `${brand}: your verification code is ${code}. It expires in 5 minutes.`,
        // StatusCallback : un OTP filtré en silence par un carrier A2P empêche la
        // connexion. Le webhook (/api/webhooks/twilio → smsDeliveries) le révèle.
        statusCallback: `${appBaseUrl}/api/webhooks/twilio`,
      });
      if (!smsResult.ok) {
        if (smsResult.error === 'TWILIO_NOT_CONFIGURED') {
          throw new Error('SMS_NOT_CONFIGURED');
        }
        throw new Error('SMS_SEND_FAILED');
      }
      // Le helper ne pose `mock: true` que si E2E_MODE === '1' — même garde-fou
      // F-04 que WhatsApp : aucun log d'OTP en clair hors E2E.
      if (smsResult.mock) {
        console.info(`[twilio:mock] OTP ${code} -> ${normalized}`);
        return { phone: normalized, channel: 'sms' as const, provider: 'mock' as const };
      }
      // Journalise l'envoi réel (kind 'otp', sans guest/event) : le webhook
      // StatusCallback mettra à jour le statut de livraison réel.
      if (smsResult.messageId) {
        await ctx.runMutation(internal.smsDeliveries.record, {
          twilioSid: smsResult.messageId,
          kind: 'otp' as const,
          to: normalized,
          status: 'sent' as const,
        });
      }
      return { phone: normalized, channel: 'sms' as const, provider: 'twilio' as const };
    }

    const templateName = process.env.WHATSAPP_OTP_TEMPLATE ?? 'otp_code';

    // Refactor R2 : utilise le helper unifié sendWhatsAppCloudTemplate.
    // Sécurité F-04 : le helper court-circuite Meta UNIQUEMENT si
    // `E2E_MODE === '1'`. Hors E2E, en absence de credentials, il
    // retourne `{ ok: false, error: 'WHATSAPP_NOT_CONFIGURED' }` —
    // pas de log silencieux qui exposerait l'OTP en prod.
    const result = await sendWhatsAppCloudTemplate({
      to: normalized,
      templateName,
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: code }],
        },
      ],
    });

    if (!result.ok) {
      if (result.error === 'WHATSAPP_NOT_CONFIGURED') {
        throw new Error('WHATSAPP_NOT_CONFIGURED');
      }
      throw new Error('WHATSAPP_SEND_FAILED');
    }
    if (result.mock) {
      console.info(`[whatsapp:mock] OTP ${code} -> ${normalized}`);
      return { phone: normalized, channel: 'whatsapp' as const, provider: 'mock' as const };
    }
    return { phone: normalized, channel: 'whatsapp' as const, provider: 'meta_cloud' as const };
  },
});

export const verifyOtp = mutation({
  args: {
    phone: v.string(),
    code: v.string(),
  },
  handler: async (ctx, { phone, code }) => {
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidE164(normalized)) {
      throw new Error('INVALID_PHONE');
    }

    if (!/^\d{6}$/.test(code)) {
      throw new Error('INVALID_CODE');
    }

    const now = Date.now();

    const session = await ctx.db
      .query('otpSessions')
      .withIndex('by_phone', (q) => q.eq('phone', normalized))
      .filter((q) => q.eq(q.field('consumedAt'), undefined))
      .order('desc')
      .first();

    if (!session) {
      throw new Error('NO_ACTIVE_OTP');
    }

    if (session.expiresAt < now) {
      throw new Error('OTP_EXPIRED');
    }

    if (session.attempts >= MAX_ATTEMPTS) {
      throw new Error('TOO_MANY_ATTEMPTS');
    }

    const valid = await verifyOtpHash(code, normalized, session.codeHash);
    await ctx.db.patch(session._id, { attempts: session.attempts + 1 });

    if (!valid) {
      throw new Error('INVALID_CODE');
    }

    await ctx.db.patch(session._id, { consumedAt: now });

    let userId: Id<'users'>;
    const existing = await ctx.db
      .query('users')
      .withIndex('by_phone', (q) => q.eq('phone', normalized))
      .first();

    if (existing) {
      // Un compte suspendu ne se reconnecte pas : sans ça, la sanction ne
      // coupait rien tant que la personne gardait un canal d'authentification.
      if (isSuspended(existing)) throw new Error('ACCOUNT_SUSPENDED');
      await ctx.db.patch(existing._id, { lastSeenAt: now });
      userId = existing._id;
    } else {
      userId = await ctx.db.insert('users', {
        phone: normalized,
        locale: 'fr',
        role: 'couple',
        createdAt: now,
        lastSeenAt: now,
      });
    }

    // La valeur d'environnement est normalisée comme le numéro : un
    // `ADMIN_PHONE=06 12 93 17 79` ne promouvait personne, sans le dire.
    if (
      matchesConfiguredAdmin({
        configured: process.env.ADMIN_PHONE,
        actual: normalized,
        normalize: (value) => normalizePhone(value),
      })
    ) {
      const user = await ctx.db.get(userId);
      if (user && user.role !== 'admin') {
        await ctx.db.patch(userId, { role: 'admin' });
      }
    }

    const sessionToken = crypto.randomUUID();
    // `isNewUser` distingue une vraie inscription d'une reconnexion (l'OTP sert
    // aux deux) — exploité pour l'event analytics `signup_completed`.
    return { userId, sessionToken, phone: normalized, isNewUser: !existing };
  },
});

export const currentUser = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const { phone, email, fullName, avatarUrl, role, locale, planTier, createdAt, lastSeenAt } =
      user;
    return {
      _id: user._id,
      phone,
      email,
      fullName,
      avatarUrl,
      role,
      locale,
      planTier,
      createdAt,
      lastSeenAt,
      // Exposé pour que la session déjà émise soit refusée côté Next : bloquer
      // la connexion ne suffit pas, un cookie valide survit à la suspension.
      suspendedAt: user.suspendedAt,
    };
  },
});

export const userByPhone = query({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_phone', (q) => q.eq('phone', phone))
      .first();
    if (!user) return null;
    // Surface minimale : `dev-login` (seul appelant, route prod-bloquée) n'a
    // besoin que de l'id + du téléphone. On n'expose PAS email/nom/rôle par
    // numéro — une query publique complète = énumération de comptes + fuite PII
    // via un appel direct à l'URL Convex. Cf. audit archi 2026-07-19.
    return {
      _id: user._id,
      phone: user.phone,
    };
  },
});

/* -------------------------------------------------------------------------- */
/*  Email Magic Link — fallback auth pour les utilisateurs sans WhatsApp.     */
/*  Pattern miroir de requestOtp/verifyOtp avec un token long single-use.     */
/* -------------------------------------------------------------------------- */

export const requestMagicLink = action({
  args: {
    email: v.string(),
    ipAddress: v.optional(v.string()),
    /**
     * Locale du visiteur (récupérée depuis la route Next.js qui invoque cette
     * action). Utilisée pour rendre l'email dans la bonne langue. Si l'user
     * existe déjà avec une locale persistée, on la priorise.
     */
    locale: v.optional(v.string()),
  },
  handler: async (ctx, { email, ipAddress, locale }) => {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      throw new Error('INVALID_EMAIL');
    }

    const rateOk = await ctx.runQuery(internal.auth._checkMagicLinkRate, {
      email: normalized,
    });
    if (!rateOk) {
      throw new Error('RATE_LIMITED');
    }

    const token = generateMagicToken();
    const tokenHash = await hashMagicToken(token, normalized);

    await ctx.runMutation(internal.auth._saveMagicLinkSession, {
      email: normalized,
      tokenHash,
      ipAddress,
    });

    const existingUser = await ctx.runQuery(internal.auth._userByEmail, {
      email: normalized,
    });

    // Envoi via SES (driver mock en dev). On délègue à emailActions pour
    // que le SES client soit instancié dans un node action.
    await ctx.runAction(internal.emailActions.sendMagicLinkEmail, {
      to: normalized,
      token,
      ipAddress,
      locale: existingUser?.locale ?? locale,
    });

    return { email: normalized };
  },
});

export const verifyMagicLink = mutation({
  args: {
    email: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { email, token }) => {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      throw new Error('INVALID_EMAIL');
    }
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw new Error('INVALID_TOKEN');
    }

    const now = Date.now();

    const session = await ctx.db
      .query('magicLinkSessions')
      .withIndex('by_email', (q) => q.eq('email', normalized))
      .filter((q) => q.eq(q.field('consumedAt'), undefined))
      .order('desc')
      .first();

    if (!session) {
      throw new Error('NO_ACTIVE_LINK');
    }

    if (session.expiresAt < now) {
      throw new Error('LINK_EXPIRED');
    }

    const valid = await verifyMagicTokenHash(token, normalized, session.tokenHash);

    if (!valid) {
      throw new Error('INVALID_TOKEN');
    }

    await ctx.db.patch(session._id, { consumedAt: now });

    let userId: Id<'users'>;
    const existing = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', normalized))
      .first();

    if (existing) {
      // Même refus que sur le chemin OTP : les deux voies d'authentification
      // doivent tenir, sinon la suspension ne ferme qu'une porte sur deux.
      if (isSuspended(existing)) throw new Error('ACCOUNT_SUSPENDED');
      await ctx.db.patch(existing._id, { lastSeenAt: now });
      userId = existing._id;
    } else {
      userId = await ctx.db.insert('users', {
        email: normalized,
        locale: 'fr',
        role: 'couple',
        createdAt: now,
        lastSeenAt: now,
      });
    }

    // Symétrique d'`ADMIN_PHONE` sur le chemin OTP. Sans cette branche, un
    // compte qui ne se connecte QUE par e-mail ne pouvait jamais devenir
    // administrateur : il restait `couple` à vie, quelle que soit la
    // configuration.
    if (
      matchesConfiguredAdmin({
        configured: process.env.ADMIN_EMAIL,
        actual: normalized,
        normalize: (value) => normalizeEmail(value),
      })
    ) {
      const user = await ctx.db.get(userId);
      if (user && user.role !== 'admin') {
        await ctx.db.patch(userId, { role: 'admin' });
      }
    }

    const sessionToken = crypto.randomUUID();
    // `isNewUser` distingue une vraie inscription d'une reconnexion (le magic
    // link sert aux deux) — exploité pour l'event analytics `signup_completed`.
    return { userId, sessionToken, email: normalized, isNewUser: !existing };
  },
});

export const _checkMagicLinkRate = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const windowStart = Date.now() - MAGIC_LINK_RATE_WINDOW_MS;
    const recent = await ctx.db
      .query('magicLinkSessions')
      .withIndex('by_email_expires', (q) => q.eq('email', email).gte('expiresAt', windowStart))
      .collect();
    return recent.length < MAX_MAGIC_LINKS_PER_HOUR;
  },
});

export const _saveMagicLinkSession = internalMutation({
  args: {
    email: v.string(),
    tokenHash: v.string(),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, { email, tokenHash, ipAddress }) => {
    const now = Date.now();
    return ctx.db.insert('magicLinkSessions', {
      email,
      tokenHash,
      expiresAt: now + MAGIC_LINK_EXPIRY_MS,
      createdAt: now,
      ...(ipAddress ? { ipAddress } : {}),
    });
  },
});

export const _checkRate = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const windowStart = Date.now() - RATE_WINDOW_MS;
    const recent = await ctx.db
      .query('otpSessions')
      .withIndex('by_phone_expires', (q) => q.eq('phone', phone).gte('expiresAt', windowStart))
      .collect();
    return recent.length < MAX_OTP_PER_HOUR;
  },
});

export const _saveOtpSession = internalMutation({
  args: {
    phone: v.string(),
    codeHash: v.string(),
    channel: v.optional(v.union(v.literal('whatsapp'), v.literal('sms'))),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, { phone, codeHash, channel, ipAddress }) => {
    const now = Date.now();
    return ctx.db.insert('otpSessions', {
      phone,
      codeHash,
      channel: channel ?? 'whatsapp',
      attempts: 0,
      expiresAt: now + OTP_EXPIRY_MS,
      createdAt: now,
      ...(ipAddress ? { ipAddress } : {}),
    });
  },
});

/* -------------------------------------------------------------------------- */
/*  Link verifications — ajouter un identifiant (phone OU email) à un user    */
/*  existant. OTP 6 digits envoyés via WhatsApp ou SES.                       */
/* -------------------------------------------------------------------------- */

const LINK_EXPIRY_MS = 10 * 60 * 1000;
const MAX_LINK_ATTEMPTS = 5;
const MAX_LINKS_PER_HOUR = 5;
const LINK_RATE_WINDOW_MS = 60 * 60 * 1000;

export const requestLinkPhone = action({
  args: {
    userId: v.id('users'),
    phone: v.string(),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, { userId, phone, ipAddress }) => {
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidE164(normalized)) {
      throw new Error('INVALID_PHONE');
    }

    const conflict = await ctx.runQuery(internal.auth._userByPhone, { phone: normalized });
    if (conflict && conflict._id !== userId) {
      throw new Error('PHONE_TAKEN');
    }
    if (conflict && conflict._id === userId) {
      throw new Error('ALREADY_LINKED');
    }

    const rateOk = await ctx.runQuery(internal.auth._checkLinkRate, {
      userId,
      targetKind: 'phone' as const,
    });
    if (!rateOk) {
      throw new Error('RATE_LIMITED');
    }

    const code = generateOtpCode();
    const codeHash = await hashOtp(code, normalized);

    await ctx.runMutation(internal.auth._saveLinkVerification, {
      userId,
      targetKind: 'phone' as const,
      targetValue: normalized,
      codeHash,
      ipAddress,
    });

    const templateName = process.env.WHATSAPP_OTP_TEMPLATE ?? 'otp_code';

    // Refactor R2 + sécurité F-04 : helper unifié, court-circuit STRICT
    // sur E2E_MODE === '1', sinon throw si credentials absents.
    const result = await sendWhatsAppCloudTemplate({
      to: normalized,
      templateName,
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: code }],
        },
      ],
    });

    if (!result.ok) {
      if (result.error === 'WHATSAPP_NOT_CONFIGURED') {
        throw new Error('WHATSAPP_NOT_CONFIGURED');
      }
      throw new Error('WHATSAPP_SEND_FAILED');
    }
    if (result.mock) {
      console.info(`[whatsapp:mock] LINK ${code} -> ${normalized}`);
    }
    return { phone: normalized, channel: 'whatsapp' as const, provider: 'meta_cloud' as const };
  },
});

export const verifyLinkPhone = mutation({
  args: {
    userId: v.id('users'),
    phone: v.string(),
    code: v.string(),
  },
  handler: async (ctx, { userId, phone, code }) => {
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidE164(normalized)) {
      throw new Error('INVALID_PHONE');
    }
    if (!/^\d{6}$/.test(code)) {
      throw new Error('INVALID_CODE');
    }

    const now = Date.now();
    const verification = await ctx.db
      .query('linkVerifications')
      .withIndex('by_user_kind', (q) => q.eq('userId', userId).eq('targetKind', 'phone'))
      .filter((q) =>
        q.and(q.eq(q.field('targetValue'), normalized), q.eq(q.field('consumedAt'), undefined)),
      )
      .order('desc')
      .first();

    if (!verification) throw new Error('NO_ACTIVE_LINK');
    if (verification.expiresAt < now) throw new Error('LINK_EXPIRED');
    if (verification.attempts >= MAX_LINK_ATTEMPTS) throw new Error('TOO_MANY_ATTEMPTS');

    const valid = await verifyOtpHash(code, normalized, verification.codeHash);
    await ctx.db.patch(verification._id, { attempts: verification.attempts + 1 });
    if (!valid) throw new Error('INVALID_CODE');

    // Race-condition defense : revérifier qu'aucun autre user n'a pris ce
    // phone entre le request et le verify.
    const conflict = await ctx.db
      .query('users')
      .withIndex('by_phone', (q) => q.eq('phone', normalized))
      .first();
    if (conflict && conflict._id !== userId) {
      throw new Error('PHONE_TAKEN');
    }

    await ctx.db.patch(verification._id, { consumedAt: now });
    await ctx.db.patch(userId, { phone: normalized, lastSeenAt: now });
    return { ok: true as const };
  },
});

export const requestLinkEmail = action({
  args: {
    userId: v.id('users'),
    email: v.string(),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, { userId, email, ipAddress }) => {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      throw new Error('INVALID_EMAIL');
    }

    const conflict = await ctx.runQuery(internal.auth._userByEmail, { email: normalized });
    if (conflict && conflict._id !== userId) {
      throw new Error('EMAIL_TAKEN');
    }
    if (conflict && conflict._id === userId) {
      throw new Error('ALREADY_LINKED');
    }

    const rateOk = await ctx.runQuery(internal.auth._checkLinkRate, {
      userId,
      targetKind: 'email' as const,
    });
    if (!rateOk) {
      throw new Error('RATE_LIMITED');
    }

    const code = generateOtpCode();
    const codeHash = await hashOtp(code, normalized);

    await ctx.runMutation(internal.auth._saveLinkVerification, {
      userId,
      targetKind: 'email' as const,
      targetValue: normalized,
      codeHash,
      ipAddress,
    });

    // L'user existe déjà (puisqu'on lie un email à un compte) — on récupère
    // sa locale pour le rendu de l'email.
    const requester = await ctx.runQuery(internal.auth._userById, { userId });

    await ctx.runAction(internal.emailActions.sendLinkCodeEmail, {
      to: normalized,
      code,
      ipAddress,
      locale: requester?.locale,
    });

    return { email: normalized };
  },
});

export const verifyLinkEmail = mutation({
  args: {
    userId: v.id('users'),
    email: v.string(),
    code: v.string(),
  },
  handler: async (ctx, { userId, email, code }) => {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      throw new Error('INVALID_EMAIL');
    }
    if (!/^\d{6}$/.test(code)) {
      throw new Error('INVALID_CODE');
    }

    const now = Date.now();
    const verification = await ctx.db
      .query('linkVerifications')
      .withIndex('by_user_kind', (q) => q.eq('userId', userId).eq('targetKind', 'email'))
      .filter((q) =>
        q.and(q.eq(q.field('targetValue'), normalized), q.eq(q.field('consumedAt'), undefined)),
      )
      .order('desc')
      .first();

    if (!verification) throw new Error('NO_ACTIVE_LINK');
    if (verification.expiresAt < now) throw new Error('LINK_EXPIRED');
    if (verification.attempts >= MAX_LINK_ATTEMPTS) throw new Error('TOO_MANY_ATTEMPTS');

    const valid = await verifyOtpHash(code, normalized, verification.codeHash);
    await ctx.db.patch(verification._id, { attempts: verification.attempts + 1 });
    if (!valid) throw new Error('INVALID_CODE');

    const conflict = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', normalized))
      .first();
    if (conflict && conflict._id !== userId) {
      throw new Error('EMAIL_TAKEN');
    }

    await ctx.db.patch(verification._id, { consumedAt: now });
    await ctx.db.patch(userId, { email: normalized, lastSeenAt: now });
    return { ok: true as const };
  },
});

export const _userById = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    return ctx.db.get(userId);
  },
});

export const _userByPhone = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    return ctx.db
      .query('users')
      .withIndex('by_phone', (q) => q.eq('phone', phone))
      .first();
  },
});

export const _userByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first();
  },
});

export const _checkLinkRate = internalQuery({
  args: {
    userId: v.id('users'),
    targetKind: v.union(v.literal('phone'), v.literal('email')),
  },
  handler: async (ctx, { userId, targetKind }) => {
    const windowStart = Date.now() - LINK_RATE_WINDOW_MS;
    const recent = await ctx.db
      .query('linkVerifications')
      .withIndex('by_user_kind_expires', (q) =>
        q.eq('userId', userId).eq('targetKind', targetKind).gte('expiresAt', windowStart),
      )
      .collect();
    return recent.length < MAX_LINKS_PER_HOUR;
  },
});

export const _saveLinkVerification = internalMutation({
  args: {
    userId: v.id('users'),
    targetKind: v.union(v.literal('phone'), v.literal('email')),
    targetValue: v.string(),
    codeHash: v.string(),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, { userId, targetKind, targetValue, codeHash, ipAddress }) => {
    const now = Date.now();
    return ctx.db.insert('linkVerifications', {
      userId,
      targetKind,
      targetValue,
      codeHash,
      attempts: 0,
      expiresAt: now + LINK_EXPIRY_MS,
      createdAt: now,
      ...(ipAddress ? { ipAddress } : {}),
    });
  },
});

/* -------------------------------------------------------------------------- */
/*  E2E test helpers — réservés aux tests Playwright. Tous les chemins ici    */
/*  vérifient `process.env.E2E_MODE === '1'` côté Convex et lèvent une        */
/*  erreur sinon. Ne JAMAIS activer `E2E_MODE` en prod.                       */
/* -------------------------------------------------------------------------- */

/**
 * Pendant E2E uniquement : génère un OTP de linking phone, le persiste en
 * base, et retourne le code en clair pour que le test puisse appeler
 * `verifyLinkPhone` ensuite. Aucun envoi WhatsApp réel — court-circuit total.
 */
export const _e2eIssueLinkPhoneCode = action({
  args: {
    userId: v.id('users'),
    phone: v.string(),
  },
  handler: async (ctx, { userId, phone }) => {
    if (process.env.E2E_MODE !== '1') {
      throw new Error('E2E_MODE_DISABLED');
    }
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidE164(normalized)) {
      throw new Error('INVALID_PHONE');
    }

    const conflict = await ctx.runQuery(internal.auth._userByPhone, { phone: normalized });
    if (conflict && conflict._id !== userId) {
      throw new Error('PHONE_TAKEN');
    }
    if (conflict && conflict._id === userId) {
      throw new Error('ALREADY_LINKED');
    }

    const code = generateOtpCode();
    const codeHash = await hashOtp(code, normalized);

    await ctx.runMutation(internal.auth._saveLinkVerification, {
      userId,
      targetKind: 'phone' as const,
      targetValue: normalized,
      codeHash,
    });

    return { phone: normalized, code };
  },
});

/**
 * Pendant E2E uniquement : génère un OTP de linking email, le persiste en
 * base, et retourne le code en clair. Pas d'envoi SES réel.
 */
export const _e2eIssueLinkEmailCode = action({
  args: {
    userId: v.id('users'),
    email: v.string(),
  },
  handler: async (ctx, { userId, email }) => {
    if (process.env.E2E_MODE !== '1') {
      throw new Error('E2E_MODE_DISABLED');
    }
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      throw new Error('INVALID_EMAIL');
    }

    const conflict = await ctx.runQuery(internal.auth._userByEmail, { email: normalized });
    if (conflict && conflict._id !== userId) {
      throw new Error('EMAIL_TAKEN');
    }
    if (conflict && conflict._id === userId) {
      throw new Error('ALREADY_LINKED');
    }

    const code = generateOtpCode();
    const codeHash = await hashOtp(code, normalized);

    await ctx.runMutation(internal.auth._saveLinkVerification, {
      userId,
      targetKind: 'email' as const,
      targetValue: normalized,
      codeHash,
    });

    return { email: normalized, code };
  },
});
