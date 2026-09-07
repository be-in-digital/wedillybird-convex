import { v } from 'convex/values';
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { BUDGET_CURRENCY } from './lib/currency';
import { pickUniqueSlug, slugifyOrgName } from './lib/uniqueSlug';
import { seatLimitForTier } from './lib/entitlements';

const ROLE = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('planner'),
  v.literal('viewer'),
);

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

async function getMembership(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<'organizations'>,
  userId: Id<'users'>,
): Promise<Doc<'organizationMemberships'> | null> {
  return ctx.db
    .query('organizationMemberships')
    .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId).eq('userId', userId))
    .first();
}

async function assertCanManage(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<'organizations'>,
  userId: Id<'users'>,
): Promise<void> {
  const membership = await getMembership(ctx, organizationId, userId);
  if (!membership || membership.status !== 'active') throw new Error('FORBIDDEN');
  if (membership.role !== 'owner' && membership.role !== 'admin') throw new Error('FORBIDDEN');
}

async function assertCanRead(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<'organizations'>,
  userId: Id<'users'>,
): Promise<Doc<'organizationMemberships'>> {
  const membership = await getMembership(ctx, organizationId, userId);
  if (!membership || membership.status !== 'active') throw new Error('FORBIDDEN');
  return membership;
}

export const create = mutation({
  args: {
    ownerId: v.id('users'),
    name: v.string(),
    primaryColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    currency: v.optional(BUDGET_CURRENCY),
  },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.ownerId);
    if (!owner) throw new Error('USER_NOT_FOUND');
    if (owner.role !== 'pro' && owner.role !== 'admin') throw new Error('NOT_PRO');

    const trimmed = args.name.trim();
    if (trimmed.length < 1 || trimmed.length > 120) throw new Error('INVALID_NAME');

    const baseSlug = slugifyOrgName(trimmed) || `org-${randomSuffix()}`;
    const slug = await pickUniqueSlug(ctx, 'organizations', 'by_slug', 'slug', baseSlug);
    const now = Date.now();

    const id = await ctx.db.insert('organizations', {
      ownerId: args.ownerId,
      name: trimmed,
      slug,
      primaryColor: args.primaryColor,
      accentColor: args.accentColor,
      ...(args.currency ? { currency: args.currency } : {}),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert('organizationMemberships', {
      organizationId: id,
      userId: args.ownerId,
      role: 'owner',
      status: 'active',
      invitedBy: args.ownerId,
      invitedAt: now,
      acceptedAt: now,
    });

    return { id, slug };
  },
});

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

function assertHexColor(value: string, field: string): void {
  if (!HEX_COLOR_RE.test(value.trim())) throw new Error(`INVALID_${field}`);
}

export const updateBranding = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    name: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    logoStorageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, args) => {
    await assertCanManage(ctx, args.organizationId, args.requesterId);
    const patch: Partial<Doc<'organizations'>> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const trimmed = args.name.trim();
      if (trimmed.length < 1 || trimmed.length > 120) throw new Error('INVALID_NAME');
      patch.name = trimmed;
    }
    if (args.primaryColor !== undefined) {
      assertHexColor(args.primaryColor, 'PRIMARY_COLOR');
      patch.primaryColor = args.primaryColor.trim();
    }
    if (args.accentColor !== undefined) {
      assertHexColor(args.accentColor, 'ACCENT_COLOR');
      patch.accentColor = args.accentColor.trim();
    }
    if (args.logoStorageId !== undefined) patch.logoStorageId = args.logoStorageId;
    await ctx.db.patch(args.organizationId, patch);
    return { ok: true as const };
  },
});

/** Met à jour les réglages messagerie par défaut de l'organisation (owner/admin). */
export const updateMessagingDefaults = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    defaults: v.object({
      channel: v.union(v.literal('whatsapp'), v.literal('sms'), v.literal('auto')),
      senderName: v.string(),
      defaultTemplate: v.union(
        v.literal('editorial'),
        v.literal('classic'),
        v.literal('modern'),
        v.literal('festive'),
        v.literal('sober'),
      ),
      reminderJ7: v.boolean(),
      reminderJ1: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    await assertCanManage(ctx, args.organizationId, args.requesterId);
    const senderName = args.defaults.senderName.trim().slice(0, 120) || 'Wedillybird';
    await ctx.db.patch(args.organizationId, {
      messagingDefaults: { ...args.defaults, senderName },
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

const NOTIF_CHANNEL = v.object({ email: v.boolean(), app: v.boolean() });

/** Met à jour les préférences de notification de l'organisation (owner/admin). */
export const updateNotificationPrefs = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    prefs: v.object({
      rsvp: NOTIF_CHANNEL,
      payment: NOTIF_CHANNEL,
      newLead: NOTIF_CHANNEL,
      taskDue: NOTIF_CHANNEL,
      weeklyDigest: NOTIF_CHANNEL,
    }),
  },
  handler: async (ctx, args) => {
    await assertCanManage(ctx, args.organizationId, args.requesterId);
    await ctx.db.patch(args.organizationId, {
      notificationPrefs: args.prefs,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Réglages d'encaissement (module Paiements) : mode `byop` (compte Stripe de
 * l'agence connecté via OAuth) ou `manual` (suivi hors ligne). Owner/admin
 * uniquement. Le mode `managed` (legacy) n'est plus acceptable.
 */
export const setPaymentsSettings = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    mode: v.optional(v.union(v.literal('byop'), v.literal('manual'))),
  },
  handler: async (ctx, args) => {
    await assertCanManage(ctx, args.organizationId, args.requesterId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.mode !== undefined) patch.paymentsMode = args.mode;
    await ctx.db.patch(args.organizationId, patch);
    return { ok: true as const };
  },
});

/**
 * Zone de danger — transfert de propriété. Réservé au propriétaire actuel.
 * Rétrograde l'ancien propriétaire en admin et promeut un membre actif en owner.
 */
export const transferOwnership = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    newOwnerUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new Error('NOT_FOUND');
    if (org.ownerId !== args.requesterId) throw new Error('OWNER_ONLY');
    if (args.newOwnerUserId === args.requesterId) throw new Error('ALREADY_OWNER');
    const memberships = await ctx.db
      .query('organizationMemberships')
      .withIndex('by_organization', (q) => q.eq('organizationId', org._id))
      .collect();
    const current = memberships.find((m) => m.userId === args.requesterId);
    const target = memberships.find(
      (m) => m.userId === args.newOwnerUserId && m.status === 'active',
    );
    if (!target) throw new Error('MEMBER_NOT_FOUND');
    await ctx.db.patch(org._id, { ownerId: args.newOwnerUserId, updatedAt: Date.now() });
    if (current) await ctx.db.patch(current._id, { role: 'admin' });
    await ctx.db.patch(target._id, { role: 'owner' });
    return { ok: true as const };
  },
});

/**
 * Zone de danger — suppression définitive de l'organisation et de ses données.
 * Réservé au propriétaire ; exige la saisie exacte du nom de l'agence. Cascade
 * sur les tables rattachées (événements + enfants, clients, prestataires,
 * budget, planning, devis, contrats, membres).
 */
export const deleteOrganization = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    confirmName: v.string(),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new Error('NOT_FOUND');
    if (org.ownerId !== args.requesterId) throw new Error('OWNER_ONLY');
    if (args.confirmName.trim() !== org.name) throw new Error('NAME_MISMATCH');
    const orgId = org._id;

    // Événements + enfants par événement.
    const events = await ctx.db
      .query('events')
      .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
      .collect();
    for (const ev of events) {
      for (const g of await ctx.db
        .query('guests')
        .withIndex('by_event', (q) => q.eq('eventId', ev._id))
        .collect())
        await ctx.db.delete(g._id);
      for (const ph of await ctx.db
        .query('photos')
        .withIndex('by_event', (q) => q.eq('eventId', ev._id))
        .collect())
        await ctx.db.delete(ph._id);
      await ctx.db.delete(ev._id);
    }

    // Clients + notes.
    const clients = await ctx.db
      .query('clients')
      .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
      .collect();
    for (const c of clients) {
      for (const n of await ctx.db
        .query('clientNotes')
        .withIndex('by_client', (q) => q.eq('clientId', c._id))
        .collect())
        await ctx.db.delete(n._id);
      await ctx.db.delete(c._id);
    }

    // Tables org-scoped restantes.
    for (const vd of await ctx.db
      .query('vendors')
      .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
      .collect())
      await ctx.db.delete(vd._id);
    for (const en of await ctx.db
      .query('vendorEngagements')
      .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
      .collect())
      await ctx.db.delete(en._id);
    for (const t of await ctx.db
      .query('planningTasks')
      .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
      .collect())
      await ctx.db.delete(t._id);
    for (const bl of await ctx.db
      .query('budgetLines')
      .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
      .collect())
      await ctx.db.delete(bl._id);
    for (const ct of await ctx.db
      .query('contracts')
      .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
      .collect())
      await ctx.db.delete(ct._id);
    for (const qd of await ctx.db
      .query('quoteDocs')
      .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
      .collect())
      await ctx.db.delete(qd._id);
    for (const m of await ctx.db
      .query('organizationMemberships')
      .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
      .collect())
      await ctx.db.delete(m._id);

    await ctx.db.delete(orgId);
    return { ok: true as const };
  },
});

/**
 * Marque blanche totale (Agency) : domaine sur mesure, e-mail expéditeur,
 * retrait du badge Wedillybird. Réservé aux owners/admins d'une org Agency.
 */
export const updateWhiteLabel = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    customDomain: v.optional(v.string()),
    senderEmail: v.optional(v.string()),
    whiteLabelFull: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await assertCanManage(ctx, args.organizationId, args.requesterId);
    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new Error('NOT_FOUND');
    if (org.subscriptionTier !== 'agency') throw new Error('FEATURE_NOT_IN_PLAN');
    const patch: Partial<Doc<'organizations'>> = { updatedAt: Date.now() };
    if (args.customDomain !== undefined) {
      const d = args.customDomain
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./, '');
      if (d && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) throw new Error('INVALID_DOMAIN');
      patch.customDomain = d || undefined;
    }
    if (args.senderEmail !== undefined) {
      const e = args.senderEmail.trim().toLowerCase();
      if (e && !/^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/.test(e)) throw new Error('INVALID_EMAIL');
      patch.senderEmail = e || undefined;
    }
    if (args.whiteLabelFull !== undefined) patch.whiteLabelFull = args.whiteLabelFull;
    await ctx.db.patch(args.organizationId, patch);
    return { ok: true as const };
  },
});

/**
 * Generates a single-use upload URL pointing at Convex storage. The client
 * POSTs the logo file directly to this URL (multipart) and gets back a
 * `{ storageId }` it then commits via `setLogo`.
 *
 * Permission : seuls les owners/admins de l'orga peuvent obtenir une URL
 * d'upload. On vérifie d'abord la membership avant d'allouer un slot storage,
 * pour éviter qu'un user authentifié sans droit obtienne une URL signée.
 */
export const generateLogoUploadUrl = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
  },
  handler: async (ctx, { organizationId, requesterId }) => {
    await assertCanManage(ctx, organizationId, requesterId);
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

/**
 * Commits a freshly uploaded logo : remplace `logoStorageId` et supprime
 * l'ancien blob si présent (économie de stockage). On ne touche pas aux
 * couleurs ici — le composant `BrandingForm` enchaîne logo + couleurs via
 * `updateBranding` quand l'utilisateur soumet.
 */
export const setLogo = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    logoStorageId: v.id('_storage'),
  },
  handler: async (ctx, { organizationId, requesterId, logoStorageId }) => {
    await assertCanManage(ctx, organizationId, requesterId);
    const org = await ctx.db.get(organizationId);
    if (!org) throw new Error('NOT_FOUND');
    const previous = org.logoStorageId;
    await ctx.db.patch(organizationId, {
      logoStorageId,
      updatedAt: Date.now(),
    });
    if (previous && previous !== logoStorageId) {
      // Best-effort cleanup — si la suppression rate (storage déjà GC), on
      // continue sans bloquer.
      try {
        await ctx.storage.delete(previous);
      } catch {
        // ignore
      }
    }
    return { ok: true as const };
  },
});

/**
 * Supprime le logo courant (si présent) et nettoie le storage Convex
 * associé. Pratique pour permettre au pro de revenir à l'état "pas de logo
 * → mark Wedillybird".
 */
export const clearLogo = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
  },
  handler: async (ctx, { organizationId, requesterId }) => {
    await assertCanManage(ctx, organizationId, requesterId);
    const org = await ctx.db.get(organizationId);
    if (!org) throw new Error('NOT_FOUND');
    if (!org.logoStorageId) return { ok: true as const, alreadyEmpty: true };
    const previous = org.logoStorageId;
    await ctx.db.patch(organizationId, {
      logoStorageId: undefined,
      updatedAt: Date.now(),
    });
    try {
      await ctx.storage.delete(previous);
    } catch {
      // ignore
    }
    return { ok: true as const, alreadyEmpty: false };
  },
});

export const myOrganization = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const membership = await ctx.db
      .query('organizationMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('status'), 'active'))
      .first();
    if (!membership) return null;
    const org = await ctx.db.get(membership.organizationId);
    if (!org) return null;
    const logoUrl = org.logoStorageId ? await ctx.storage.getUrl(org.logoStorageId) : null;
    return {
      _id: org._id,
      name: org.name,
      slug: org.slug,
      primaryColor: org.primaryColor,
      accentColor: org.accentColor,
      currency: org.currency ?? null,
      logoUrl,
      customDomain: org.customDomain,
      senderEmail: org.senderEmail,
      whiteLabelFull: org.whiteLabelFull ?? false,
      notificationPrefs: org.notificationPrefs ?? null,
      messagingDefaults: org.messagingDefaults ?? null,
      paymentsMode: org.paymentsMode ?? null,
      payoutSchedule: org.payoutSchedule ?? null,
      stripeCustomerId: org.stripeCustomerId,
      subscriptionTier: org.subscriptionTier,
      subscriptionStatus: org.subscriptionStatus,
      subscriptionPeriodEnd: org.subscriptionPeriodEnd,
      // Crédits Pay-as-you-go : nécessaires côté UI pour décider de l'accès
      // back-office (une agence sans abonnement mais avec crédit PAYG a accès).
      paygCredits: org.paygCredits ?? 0,
      // Le cadeau décide de l'accès au back-office : sans lui côté client, une
      // agence à qui l'on a ouvert un compte verrait la bannière « choisissez
      // un forfait » alors que le serveur la laisse entrer.
      compedSubscription: org.compedSubscription ?? null,
      myRole: membership.role,
    };
  },
});

export const getById = query({
  args: { organizationId: v.id('organizations'), requesterId: v.id('users') },
  handler: async (ctx, { organizationId, requesterId }) => {
    const membership = await assertCanRead(ctx, organizationId, requesterId);
    const org = await ctx.db.get(organizationId);
    if (!org) throw new Error('NOT_FOUND');
    const logoUrl = org.logoStorageId ? await ctx.storage.getUrl(org.logoStorageId) : null;
    return {
      _id: org._id,
      name: org.name,
      slug: org.slug,
      primaryColor: org.primaryColor,
      accentColor: org.accentColor,
      logoUrl,
      subscriptionTier: org.subscriptionTier,
      subscriptionStatus: org.subscriptionStatus,
      myRole: membership.role,
    };
  },
});

/**
 * Lookup public d'une organisation par slug — utilisé par le layout
 * `(public-org)` côté Next pour appliquer le branding orga (logo,
 * primaryColor, accentColor) sur les pages servies sous le sous-domaine
 * `<slug>.wedillybird.com`.
 *
 * Aucune PII n'est exposée (pas de stripeCustomerId, pas de membership,
 * pas d'email/phone). On retourne uniquement ce qui est nécessaire pour
 * le rendu public d'une page d'événement ou d'invitation sous le
 * sous-domaine de l'orga.
 */
export const findBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const trimmed = slug.trim().toLowerCase();
    if (!trimmed) return null;
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', trimmed))
      .first();
    if (!org) return null;
    const logoUrl = org.logoStorageId ? await ctx.storage.getUrl(org.logoStorageId) : null;
    return {
      _id: org._id,
      name: org.name,
      slug: org.slug,
      primaryColor: org.primaryColor,
      accentColor: org.accentColor,
      logoUrl,
    };
  },
});

export const listEvents = query({
  args: { organizationId: v.id('organizations'), requesterId: v.id('users') },
  handler: async (ctx, { organizationId, requesterId }) => {
    await assertCanRead(ctx, organizationId, requesterId);
    const events = await ctx.db
      .query('events')
      .withIndex('by_organization', (q) => q.eq('organizationId', organizationId))
      .collect();
    // Tri par date de mariage croissante : le mariage le plus proche en premier
    // (défaut sensé pour les sélecteurs budget/rétroplanning/plan de table).
    events.sort((a, b) => a.eventDate - b.eventDate);
    return events.map((e) => ({
      _id: e._id,
      title: e.title,
      slug: e.slug,
      coupleNames: e.coupleNames,
      eventDate: e.eventDate,
      timezone: e.timezone,
      status: e.status,
      planTier: e.planTier,
      maxGuests: e.maxGuests,
      ownerId: e.ownerId,
      venue: e.venue?.name,
    }));
  },
});

export const listMembers = query({
  args: { organizationId: v.id('organizations'), requesterId: v.id('users') },
  handler: async (ctx, { organizationId, requesterId }) => {
    await assertCanRead(ctx, organizationId, requesterId);
    const memberships = await ctx.db
      .query('organizationMemberships')
      .withIndex('by_organization', (q) => q.eq('organizationId', organizationId))
      .collect();
    return Promise.all(
      memberships.map(async (m) => {
        const user = m.userId ? await ctx.db.get(m.userId) : null;
        return {
          _id: m._id,
          userId: m.userId,
          role: m.role,
          status: m.status,
          fullName: user?.fullName,
          phone: user?.phone ?? m.invitedPhone,
          email: user?.email ?? m.invitedEmail,
          invitedAt: m.invitedAt,
          acceptedAt: m.acceptedAt,
        };
      }),
    );
  },
});

// Alphabet 32 caractères sans ambiguïtés visuelles (pas de I/O/0/1).
// 256 % 32 === 0 → pas de biais modulo, distribution uniforme.
const INVITE_TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_TOKEN_LENGTH = 20;

/**
 * Génère un token d'invitation Pro cryptographiquement sûr. Il sert à valider
 * la mutation `acceptInvite` ; un token devinable permettrait à un attaquant
 * de rejoindre n'importe quelle organisation. `crypto.getRandomValues`
 * (disponible dans le runtime Convex) garantit une entropie non prédictible.
 */
function generateInviteToken(): string {
  const buffer = new Uint8Array(INVITE_TOKEN_LENGTH);
  crypto.getRandomValues(buffer);
  let token = '';
  for (const b of buffer) token += INVITE_TOKEN_ALPHABET[b % INVITE_TOKEN_ALPHABET.length];
  return token;
}

export const invite = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    role: ROLE,
  },
  handler: async (ctx, args) => {
    await assertCanManage(ctx, args.organizationId, args.requesterId);
    if (args.role === 'owner') throw new Error('CANNOT_ASSIGN_OWNER');
    if (!args.phone && !args.email) throw new Error('NO_CONTACT');

    let userId: Id<'users'> | undefined;
    if (args.phone) {
      const existing = await ctx.db
        .query('users')
        .withIndex('by_phone', (q) => q.eq('phone', args.phone!))
        .first();
      userId = existing?._id;
    }

    if (userId) {
      const dup = await getMembership(ctx, args.organizationId, userId);
      if (dup && dup.status !== 'revoked') throw new Error('ALREADY_MEMBER');
    }

    const org = await ctx.db.get(args.organizationId);

    // Limite de sièges (grille v3 : 2 / 8 / illimité). Les membres actifs ET
    // les invitations en attente occupent un siège (l'owner inclus).
    const seatLimit = seatLimitForTier(org?.subscriptionTier);
    if (seatLimit !== null) {
      const all = await ctx.db
        .query('organizationMemberships')
        .withIndex('by_organization', (q) => q.eq('organizationId', args.organizationId))
        .collect();
      const seatsUsed = all.filter((m) => m.status === 'active' || m.status === 'pending').length;
      if (seatsUsed >= seatLimit) throw new Error('SEAT_LIMIT_REACHED');
    }

    const token = generateInviteToken();
    const now = Date.now();
    const id = await ctx.db.insert('organizationMemberships', {
      organizationId: args.organizationId,
      userId,
      invitedPhone: args.phone,
      invitedEmail: args.email,
      role: args.role,
      status: 'pending',
      inviteToken: token,
      invitedBy: args.requesterId,
      invitedAt: now,
    });

    // Notify any existing org members that someone was invited (best effort).
    if (args.email) {
      const inviter = await ctx.db.get(args.requesterId);
      if (org && inviter) {
        const inviteeName = args.email.split('@')[0];
        const inviterLabel = inviter.fullName ?? inviter.phone;
        // Le destinataire est le futur membre — pas encore en base, donc pas
        // de locale connue. On retombe sur la locale de l'inviter (préf
        // raisonnable : un planner FR invite un collègue qui parle FR).
        await ctx.scheduler.runAfter(0, internal.emailActions.sendProNotification, {
          to: args.email,
          recipientName: inviteeName ?? '',
          organizationName: org.name,
          kind: 'team-member-added' as const,
          detailKey: 'teamInviteDetail',
          detailVars: {
            inviterLabel: inviterLabel ?? '',
            organizationName: org.name,
          },
          ctaLabelKey: 'teamMemberAdded',
          ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com'}/pro/invite/${token}`,
          locale: inviter.locale,
        });
      }
    }

    return { id, inviteToken: token };
  },
});

export const acceptInvite = mutation({
  args: { token: v.string(), userId: v.id('users') },
  handler: async (ctx, { token, userId }) => {
    const membership = await ctx.db
      .query('organizationMemberships')
      .withIndex('by_invite_token', (q) => q.eq('inviteToken', token))
      .first();
    if (!membership) throw new Error('INVITE_NOT_FOUND');
    if (membership.status !== 'pending') throw new Error('INVITE_ALREADY_USED');

    await ctx.db.patch(membership._id, {
      userId,
      status: 'active',
      acceptedAt: Date.now(),
      inviteToken: undefined,
    });
    return { ok: true as const, organizationId: membership.organizationId };
  },
});

export const revokeMembership = mutation({
  args: { membershipId: v.id('organizationMemberships'), requesterId: v.id('users') },
  handler: async (ctx, { membershipId, requesterId }) => {
    const m = await ctx.db.get(membershipId);
    if (!m) throw new Error('NOT_FOUND');
    await assertCanManage(ctx, m.organizationId, requesterId);
    if (m.role === 'owner') throw new Error('CANNOT_REVOKE_OWNER');
    await ctx.db.patch(membershipId, { status: 'revoked' });
    return { ok: true as const };
  },
});

/** Change le rôle d'un membre (owner/admin uniquement ; jamais l'owner). */
export const updateMemberRole = mutation({
  args: { membershipId: v.id('organizationMemberships'), requesterId: v.id('users'), role: ROLE },
  handler: async (ctx, { membershipId, requesterId, role }) => {
    const m = await ctx.db.get(membershipId);
    if (!m) throw new Error('NOT_FOUND');
    await assertCanManage(ctx, m.organizationId, requesterId);
    if (m.role === 'owner') throw new Error('CANNOT_CHANGE_OWNER');
    if (role === 'owner') throw new Error('CANNOT_ASSIGN_OWNER');
    await ctx.db.patch(membershipId, { role });
    return { ok: true as const };
  },
});

/** Annule une invitation en attente (supprime la ligne). */
export const cancelInvite = mutation({
  args: { membershipId: v.id('organizationMemberships'), requesterId: v.id('users') },
  handler: async (ctx, { membershipId, requesterId }) => {
    const m = await ctx.db.get(membershipId);
    if (!m) throw new Error('NOT_FOUND');
    await assertCanManage(ctx, m.organizationId, requesterId);
    if (m.status !== 'pending') throw new Error('NOT_PENDING');
    await ctx.db.delete(membershipId);
    return { ok: true as const };
  },
});

/** Renvoie une invitation en attente (régénère un token). */
export const resendInvite = mutation({
  args: { membershipId: v.id('organizationMemberships'), requesterId: v.id('users') },
  handler: async (ctx, { membershipId, requesterId }) => {
    const m = await ctx.db.get(membershipId);
    if (!m) throw new Error('NOT_FOUND');
    await assertCanManage(ctx, m.organizationId, requesterId);
    if (m.status !== 'pending') throw new Error('NOT_PENDING');
    const token = generateInviteToken();
    await ctx.db.patch(membershipId, {
      inviteToken: token,
      invitedAt: Date.now(),
      invitedBy: requesterId,
    });
    return { ok: true as const, inviteToken: token };
  },
});

/** Réactive un membre révoqué (reconsomme un siège — quota vérifié). */
export const reactivateMember = mutation({
  args: { membershipId: v.id('organizationMemberships'), requesterId: v.id('users') },
  handler: async (ctx, { membershipId, requesterId }) => {
    const m = await ctx.db.get(membershipId);
    if (!m) throw new Error('NOT_FOUND');
    await assertCanManage(ctx, m.organizationId, requesterId);
    if (m.status !== 'revoked') throw new Error('NOT_REVOKED');
    const org = await ctx.db.get(m.organizationId);
    const seatLimit = seatLimitForTier(org?.subscriptionTier);
    if (seatLimit !== null) {
      const all = await ctx.db
        .query('organizationMemberships')
        .withIndex('by_organization', (q) => q.eq('organizationId', m.organizationId))
        .collect();
      const seatsUsed = all.filter((x) => x.status === 'active' || x.status === 'pending').length;
      if (seatsUsed >= seatLimit) throw new Error('SEAT_LIMIT_REACHED');
    }
    await ctx.db.patch(membershipId, { status: m.userId ? 'active' : 'pending' });
    return { ok: true as const };
  },
});

/* -------------------------------------------------------------------------- */
/*  Subscription updates — fix sécurité F-01 (audit avril 2026)               */
/*                                                                            */
/*  Avant le fix, `updateSubscription` était une mutation publique sans       */
/*  aucun check d'authorization : tout user authentifié pouvait s'upgrader    */
/*  Agency `active` 10 ans gratuitement (IDOR, CVSS 8.8). On la transforme    */
/*  en `internalMutation` (donc inaccessible au client), et on expose deux    */
/*  points d'entrée publics ciblés :                                          */
/*    - `updateSubscriptionFromWebhook` : protégé par un secret partagé entre */
/*      la route Next /api/webhooks/[provider] et l'env Convex. La signature  */
/*      Stripe a déjà été vérifiée à la frontière API ; le secret partagé    */
/*      empêche un attaquant de bypass-er la route en tapant directement      */
/*      l'API Convex publique.                                                */
/*  Les call sites côté webhook ont été migrés vers ce wrapper.               */
/* -------------------------------------------------------------------------- */

const SUBSCRIPTION_TIER = v.optional(
  v.union(v.literal('starter'), v.literal('business'), v.literal('agency')),
);
const SUBSCRIPTION_STATUS = v.optional(
  v.union(
    v.literal('trialing'),
    v.literal('active'),
    v.literal('past_due'),
    v.literal('canceled'),
    v.literal('unpaid'),
  ),
);

type SubscriptionPatchInput = {
  organizationId: Id<'organizations'>;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionTier?: 'starter' | 'business' | 'agency';
  subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
  subscriptionPeriodEnd?: number;
};

async function applySubscriptionPatch(
  ctx: MutationCtx,
  args: SubscriptionPatchInput,
): Promise<{ ok: true }> {
  const { organizationId, ...rest } = args;
  const before = await ctx.db.get(organizationId);
  // Anti-mismatch tenant : si l'org a DÉJÀ un customer Stripe rattaché, un event
  // dont le customer diffère est un mauvais routage (ou une `metadata.organizationId`
  // forgée) — on refuse plutôt que d'écraser l'abonnement d'une org avec les
  // données d'une autre. Le premier rattachement (before.stripeCustomerId absent)
  // reste permis. Aligne ce chemin sur la rigueur anti-tenant du budget/liens.
  if (
    before?.stripeCustomerId &&
    rest.stripeCustomerId &&
    before.stripeCustomerId !== rest.stripeCustomerId
  ) {
    throw new Error('STRIPE_CUSTOMER_MISMATCH');
  }
  const patch: Partial<Doc<'organizations'>> = { updatedAt: Date.now() };
  if (rest.stripeCustomerId !== undefined) patch.stripeCustomerId = rest.stripeCustomerId;
  if (rest.stripeSubscriptionId !== undefined)
    patch.stripeSubscriptionId = rest.stripeSubscriptionId;
  if (rest.subscriptionTier !== undefined) patch.subscriptionTier = rest.subscriptionTier;
  if (rest.subscriptionStatus !== undefined) patch.subscriptionStatus = rest.subscriptionStatus;
  if (rest.subscriptionPeriodEnd !== undefined)
    patch.subscriptionPeriodEnd = rest.subscriptionPeriodEnd;
  await ctx.db.patch(organizationId, patch);

  // Best-effort transition email to the org owner. Triggered once per
  // distinct transition: trialing → active (welcome), active → past_due
  // (alert), * → canceled (notice). Idempotent: only fires when the
  // status actually changed.
  if (before && rest.subscriptionStatus !== undefined) {
    const prevStatus = before.subscriptionStatus;
    const nextStatus = rest.subscriptionStatus;
    if (prevStatus !== nextStatus) {
      const owner = await ctx.db.get(before.ownerId);
      if (owner?.email) {
        let kind: 'subscription-renewed' | 'subscription-failed' | null = null;
        let detailKey:
          | 'subscriptionWelcome'
          | 'subscriptionPastDue'
          | 'subscriptionCanceled'
          | 'subscriptionRenewedDetail'
          | null = null;
        if ((prevStatus === 'trialing' || prevStatus === undefined) && nextStatus === 'active') {
          kind = 'subscription-renewed';
          detailKey = 'subscriptionWelcome';
        } else if (nextStatus === 'past_due') {
          kind = 'subscription-failed';
          detailKey = 'subscriptionPastDue';
        } else if (nextStatus === 'canceled') {
          kind = 'subscription-failed';
          detailKey = 'subscriptionCanceled';
        } else if (prevStatus === 'past_due' && nextStatus === 'active') {
          kind = 'subscription-renewed';
          detailKey = 'subscriptionRenewedDetail';
        }
        if (kind && detailKey) {
          await ctx.scheduler.runAfter(0, internal.emailActions.sendProNotification, {
            to: owner.email,
            recipientName: owner.fullName ?? owner.phone ?? '',
            organizationName: before.name,
            kind,
            detailKey,
            detailVars: { organizationName: before.name },
            ctaLabelKey: 'subscriptionRenewed',
            ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com'}/pro/billing`,
            locale: owner.locale,
          });
        }
      }
    }
  }

  return { ok: true as const };
}

/**
 * Mutation interne — patche les champs de souscription d'une organisation.
 * Inaccessible directement depuis le client : la seule façon de la déclencher
 * est via le bridge `updateSubscriptionFromWebhook` (qui valide un secret
 * partagé) ou via une autre fonction Convex via `ctx.scheduler` / `runMutation`.
 */
export const updateSubscription = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    subscriptionTier: SUBSCRIPTION_TIER,
    subscriptionStatus: SUBSCRIPTION_STATUS,
    subscriptionPeriodEnd: v.optional(v.number()),
  },
  handler: applySubscriptionPatch,
});

/**
 * Bridge public pour la route webhook Stripe (`app/api/webhooks/[provider]`).
 * Verrouillé par un secret partagé `CONVEX_WEBHOOK_SECRET`. Le secret doit
 * être posé à la fois dans l'env Vercel (côté Next) et dans l'env Convex.
 *
 * Cette mutation NE doit JAMAIS être appelée depuis du code client. La
 * vérification de signature Stripe se fait à la frontière API ; ce secret
 * partagé est une seconde ligne de défense (l'attaquant qui parle directement
 * à `*.convex.cloud` n'a pas le secret et est rejeté).
 *
 * Si `CONVEX_WEBHOOK_SECRET` n'est pas posé côté Convex, on rejette toutes
 * les requêtes — pas de fallback silencieux qui retomberait dans le bug F-01.
 */
export const updateSubscriptionFromWebhook = mutation({
  args: {
    webhookSecret: v.string(),
    organizationId: v.id('organizations'),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    subscriptionTier: SUBSCRIPTION_TIER,
    subscriptionStatus: SUBSCRIPTION_STATUS,
    subscriptionPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, { webhookSecret, ...rest }) => {
    const expected = process.env.CONVEX_WEBHOOK_SECRET;
    if (!expected) throw new Error('WEBHOOK_SECRET_NOT_CONFIGURED');
    if (webhookSecret !== expected) throw new Error('INVALID_WEBHOOK_SECRET');
    return applySubscriptionPatch(ctx, rest);
  },
});

export const findByStripeSubscription = query({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, { stripeSubscriptionId }) => {
    return ctx.db
      .query('organizations')
      .withIndex('by_stripe_subscription', (q) =>
        q.eq('stripeSubscriptionId', stripeSubscriptionId),
      )
      .first();
  },
});

export const findByStripeCustomer = query({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, { stripeCustomerId }) => {
    return ctx.db
      .query('organizations')
      .withIndex('by_stripe_customer', (q) => q.eq('stripeCustomerId', stripeCustomerId))
      .first();
  },
});

/* --------------------------- Stripe Connect (versements) --------------------------- */

/** Statut Connect d'une agence (lecture pour tout membre). */
export const connectStatus = query({
  args: { organizationId: v.id('organizations'), requesterId: v.id('users') },
  handler: async (ctx, { organizationId, requesterId }) => {
    await assertCanRead(ctx, organizationId, requesterId);
    const org = await ctx.db.get(organizationId);
    if (!org) throw new Error('NOT_FOUND');
    return {
      accountId: org.stripeConnectAccountId ?? null,
      chargesEnabled: Boolean(org.stripeConnectChargesEnabled),
      payoutsEnabled: Boolean(org.stripeConnectPayoutsEnabled),
      detailsSubmitted: Boolean(org.stripeConnectDetailsSubmitted),
    };
  },
});

/**
 * Mémorise le compte connecté **de l'agence** (Standard, onboarding hébergé) :
 * stocke son `acct_…` et passe en mode `byop`. `chargesEnabled` reste false tant
 * que l'onboarding Stripe n'est pas terminé — mis à true par `updateConnectStatus`
 * au retour de l'onboarding. Owner/admin uniquement.
 */
export const setConnectAccount = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    stripeConnectAccountId: v.string(),
  },
  handler: async (ctx, { organizationId, requesterId, stripeConnectAccountId }) => {
    await assertCanManage(ctx, organizationId, requesterId);
    await ctx.db.patch(organizationId, {
      stripeConnectAccountId,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
      paymentsMode: 'byop',
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Rafraîchit le statut du compte connecté après l'onboarding Stripe (charges /
 * details / payouts). `chargesEnabled = true` débloque la création de liens de
 * paiement. Owner/admin uniquement.
 */
export const updateConnectStatus = mutation({
  args: {
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    chargesEnabled: v.boolean(),
    detailsSubmitted: v.boolean(),
    payoutsEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await assertCanManage(ctx, args.organizationId, args.requesterId);
    await ctx.db.patch(args.organizationId, {
      stripeConnectChargesEnabled: args.chargesEnabled,
      stripeConnectDetailsSubmitted: args.detailsSubmitted,
      stripeConnectPayoutsEnabled: args.payoutsEnabled,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Déconnecte le compte Stripe de l'agence (oubli + repli en suivi manuel). */
export const disconnectStripeAccount = mutation({
  args: { organizationId: v.id('organizations'), requesterId: v.id('users') },
  handler: async (ctx, { organizationId, requesterId }) => {
    await assertCanManage(ctx, organizationId, requesterId);
    await ctx.db.patch(organizationId, {
      stripeConnectAccountId: undefined,
      stripeConnectChargesEnabled: false,
      stripeConnectDetailsSubmitted: false,
      stripeConnectPayoutsEnabled: false,
      paymentsMode: 'manual',
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});
