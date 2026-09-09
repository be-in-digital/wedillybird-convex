import { v } from 'convex/values';
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { eventHasFeature } from './lib/entitlements';
import { DEFAULT_PLANNING, isCoupleVendorCat, isCoupleVendorStatus } from './lib/coupleModel';
import {
  assertInvitationDesignAllowed,
  musicForClient,
  photoForClient,
} from './lib/invitationDesign';
import { collectVestedCredit } from './affiliate';
import { needsSeatNotification, resolveSeatingPublication } from './lib/seatPass';

/**
 * Espace couple self-serve « /mon-mariage » — backend du produit one-shot.
 * Le couple est PROPRIÉTAIRE de son event (`events.ownerId`, pas d'org) :
 * toutes les fonctions vérifient cette propriété stricte (contrairement à
 * `lib/eventAuth.assertEventAccess` qui accepte aussi les membres d'org).
 * Montants en CENTIMES dans la devise de l'event.
 */

const vendorStatusValidator = v.union(
  v.literal('a_contacter'),
  v.literal('contacte'),
  v.literal('devis'),
  v.literal('reserve'),
  v.literal('paye'),
);

const attachmentsValidator = v.optional(v.array(v.object({ name: v.string(), kind: v.string() })));

const tableShapeValidator = v.union(
  v.literal('round'),
  v.literal('oval'),
  v.literal('rect'),
  v.literal('square'),
  v.literal('imperial'),
  v.literal('sweetheart'),
  v.literal('head'),
);

async function assertOwnedEvent(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'events'>,
  requesterId: Id<'users'>,
): Promise<Doc<'events'>> {
  const event = await ctx.db.get(eventId);
  if (!event) throw new Error('EVENT_NOT_FOUND');
  if (event.ownerId !== requesterId) throw new Error('FORBIDDEN');
  return event;
}

/** Garde Premium du plan de table (miroir du gating agence). */
function assertSeatingFeature(event: Doc<'events'>): void {
  if (!eventHasFeature(event, 'seatingPlan')) throw new Error('FEATURE_LOCKED');
}

function sanitizeLabel(raw: string, max = 160): string {
  const s = raw.trim();
  if (s.length < 1 || s.length > max) throw new Error('INVALID_LABEL');
  return s;
}

function assertMinor(n: number, field: string): void {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100_000_000_00) {
    throw new Error(`INVALID_${field}`);
  }
}

/* ============================ Bundle initial ============================ */

/**
 * Snapshot complet de l'espace couple en UNE requête (une seule cohérence,
 * un seul aller-retour depuis le RSC). Retourne null si l'utilisateur n'a
 * aucun event self-serve (l'UI bascule alors en onboarding/empty state).
 */
export const bundle = query({
  args: { requesterId: v.id('users') },
  handler: async (ctx, { requesterId }) => {
    const events = await ctx.db
      .query('events')
      .withIndex('by_owner', (q) => q.eq('ownerId', requesterId))
      .collect();
    // Self-serve = pas d'organisation. On prend le plus récent non annulé/archivé,
    // sinon le plus récent tout court (le forfait/empty state gère le reste).
    const selfServe = events
      .filter((e) => !e.organizationId)
      .sort((a, b) => b._creationTime - a._creationTime);
    const event =
      selfServe.find((e) => e.status === 'active' || e.status === 'draft') ?? selfServe[0];
    if (!event) return null;

    const [guests, vendors, payments, phases, tasks, rooms, tables, invoices, photos] =
      await Promise.all([
        ctx.db
          .query('guests')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .collect(),
        ctx.db
          .query('coupleVendors')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .collect(),
        ctx.db
          .query('couplePayments')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .collect(),
        ctx.db
          .query('couplePhases')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .collect(),
        ctx.db
          .query('coupleTasks')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .collect(),
        ctx.db
          .query('coupleRooms')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .collect(),
        ctx.db
          .query('tables')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .collect(),
        ctx.db
          .query('payments')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .order('desc')
          .collect(),
        ctx.db
          .query('photos')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .collect(),
      ]);

    const storageBytes = photos.reduce((acc, p) => acc + (p.sizeBytes ?? 0), 0);

    // Parrainage : code du couple + crédit disponible (récompenses vested).
    const currency = event.currency ?? 'EUR';
    const ownerAffiliates = await ctx.db
      .query('affiliates')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', event.ownerId))
      .collect();
    const referralAff = ownerAffiliates.find((a) => a.kind === 'referral');
    const vestedCredit = await collectVestedCredit(ctx, event.ownerId, currency);
    const referralCreditMinor = vestedCredit.reduce((s, r) => s + r.rewardMinor, 0);

    return {
      event: {
        id: event._id,
        slug: event.slug,
        title: event.title,
        coupleNames: event.coupleNames,
        eventDate: event.eventDate,
        timezone: event.timezone,
        currency: event.currency ?? 'EUR',
        budgetEnvelopeMinor: event.budgetEnvelopeMinor ?? null,
        venue: event.venue ?? null,
        status: event.status,
        planTier: event.planTier ?? null,
        pendingPlanTier: event.pendingPlanTier ?? null,
        paidAt: event.paidAt ?? null,
        maxGuests: event.maxGuests,
        galleryExpiresAt: event.galleryExpiresAt ?? null,
        hdUpsellPurchasedAt: event.hdUpsellPurchasedAt ?? null,
        seatingUnlocked: eventHasFeature(event, 'seatingPlan'),
        seatingPublication: resolveSeatingPublication(event.seatingConfig),
        invitationCinematic: event.invitationCinematic ?? null,
        invitationMusic: musicForClient(event.invitationMusic),
        invitationPhoto: photoForClient(event.invitationPhoto),
        ceremonySchedule: event.ceremonySchedule ?? [],
        cinematicUnlocked: eventHasFeature(event, 'cinematicInvitation'),
      },
      referral: {
        code: referralAff?.code ?? null,
        availableMinor: referralCreditMinor,
      },
      // File d'envoi des pass placement : combien d'invités placés attendent
      // (ou re-attendent) leur place. Alimente le panneau de publication.
      seatingNotifications: seatingNotificationCounts(guests, tables),
      guests: guests.map((g) => ({
        id: g._id,
        fullName: g.fullName,
        phone: g.phone ?? null,
        category: g.category ?? null,
        plusOnesAllowed: g.plusOnesAllowed,
        rsvpStatus: g.rsvpStatus,
        tableId: g.tableId ?? null,
        seatNumber: g.tableId ? (g.seatNumber ?? null) : null,
      })),
      vendors: vendors.map((x) => ({
        id: x._id,
        name: x.name,
        category: x.category,
        status: x.status,
        amountMinor: x.amountMinor,
        paidMinor: x.paidMinor,
        contact: x.contact ?? null,
        email: x.email ?? null,
        note: x.note ?? null,
        attachments: x.attachments ?? [],
      })),
      payments: payments.map((x) => ({
        id: x._id,
        vendorId: x.vendorId ?? null,
        vendorName: x.vendorName,
        category: x.category,
        kind: x.kind,
        dueDate: x.dueDate,
        amountMinor: x.amountMinor,
        paidMinor: x.paidMinor,
        paidAt: x.paidAt ?? null,
        attachments: x.attachments ?? [],
      })),
      phases: phases
        .sort((a, b) => a.order - b.order)
        .map((p) => ({
          id: p._id,
          label: p.label ?? null,
          labelKey: p.labelKey ?? null,
          sub: p.sub ?? null,
          subKey: p.subKey ?? null,
          order: p.order,
          tasks: tasks
            .filter((t) => t.phaseId === p._id)
            .sort((a, b) => a.order - b.order)
            .map((t) => ({
              id: t._id,
              label: t.label ?? null,
              labelKey: t.labelKey ?? null,
              status: t.status,
              dueDate: t.dueDate ?? null,
            })),
        })),
      room: rooms[0]
        ? {
            name: rooms[0].name,
            widthM: rooms[0].widthM,
            lengthM: rooms[0].lengthM,
            floor: rooms[0].floor,
            elements: rooms[0].elements,
          }
        : null,
      tables: tables
        .sort((a, b) => a.order - b.order)
        .map((t) => ({
          id: t._id,
          name: t.name,
          capacity: t.capacity,
          shape: t.shape ?? 'round',
          x: t.posX ?? null,
          y: t.posY ?? null,
          rotation: t.rotation ?? 0,
          honor: t.honor ?? false,
          notes: t.notes ?? null,
        })),
      invoices: invoices
        .filter((p) => p.status === 'succeeded')
        .map((p) => ({
          id: p._id,
          kind: p.kind ?? 'plan',
          plan: p.plan ?? null,
          amountMinor: p.amountMinor,
          currency: p.currency,
          paidAt: p.updatedAt,
        })),
      usage: {
        invitations: guests.length,
        storageBytes,
      },
    };
  },
});

/* ============================ Prestataires ============================ */

export const addVendor = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    name: v.string(),
    category: v.string(),
    status: vendorStatusValidator,
    amountMinor: v.number(),
    paidMinor: v.number(),
    contact: v.optional(v.string()),
    email: v.optional(v.string()),
    note: v.optional(v.string()),
    attachments: attachmentsValidator,
  },
  handler: async (ctx, args) => {
    await assertOwnedEvent(ctx, args.eventId, args.requesterId);
    if (!isCoupleVendorCat(args.category)) throw new Error('INVALID_CATEGORY');
    if (!isCoupleVendorStatus(args.status)) throw new Error('INVALID_STATUS');
    assertMinor(args.amountMinor, 'AMOUNT');
    assertMinor(args.paidMinor, 'PAID');
    const now = Date.now();
    return ctx.db.insert('coupleVendors', {
      eventId: args.eventId,
      name: sanitizeLabel(args.name),
      category: args.category,
      status: args.status,
      amountMinor: args.amountMinor,
      paidMinor: args.paidMinor,
      ...(args.contact ? { contact: args.contact.trim() } : {}),
      ...(args.email ? { email: args.email.trim() } : {}),
      ...(args.note ? { note: args.note.trim() } : {}),
      ...(args.attachments ? { attachments: args.attachments } : {}),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateVendor = mutation({
  args: {
    vendorId: v.id('coupleVendors'),
    requesterId: v.id('users'),
    name: v.optional(v.string()),
    category: v.optional(v.string()),
    status: v.optional(vendorStatusValidator),
    amountMinor: v.optional(v.number()),
    paidMinor: v.optional(v.number()),
    contact: v.optional(v.string()),
    email: v.optional(v.string()),
    note: v.optional(v.string()),
    attachments: attachmentsValidator,
  },
  handler: async (ctx, args) => {
    const vendor = await ctx.db.get(args.vendorId);
    if (!vendor) throw new Error('VENDOR_NOT_FOUND');
    await assertOwnedEvent(ctx, vendor.eventId, args.requesterId);
    const patch: Partial<Doc<'coupleVendors'>> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = sanitizeLabel(args.name);
    if (args.category !== undefined) {
      if (!isCoupleVendorCat(args.category)) throw new Error('INVALID_CATEGORY');
      patch.category = args.category;
    }
    if (args.status !== undefined) patch.status = args.status;
    if (args.amountMinor !== undefined) {
      assertMinor(args.amountMinor, 'AMOUNT');
      patch.amountMinor = args.amountMinor;
    }
    if (args.paidMinor !== undefined) {
      assertMinor(args.paidMinor, 'PAID');
      patch.paidMinor = args.paidMinor;
    }
    if (args.contact !== undefined) patch.contact = args.contact.trim();
    if (args.email !== undefined) patch.email = args.email.trim();
    if (args.note !== undefined) patch.note = args.note.trim();
    if (args.attachments !== undefined) patch.attachments = args.attachments;
    await ctx.db.patch(args.vendorId, patch);
  },
});

export const removeVendor = mutation({
  args: { vendorId: v.id('coupleVendors'), requesterId: v.id('users') },
  handler: async (ctx, args) => {
    const vendor = await ctx.db.get(args.vendorId);
    if (!vendor) return;
    await assertOwnedEvent(ctx, vendor.eventId, args.requesterId);
    // Les échéances rattachées survivent (vendorName dénormalisé) — on coupe le lien.
    const linked = await ctx.db
      .query('couplePayments')
      .withIndex('by_vendor', (q) => q.eq('vendorId', args.vendorId))
      .collect();
    for (const p of linked) await ctx.db.patch(p._id, { vendorId: undefined });
    await ctx.db.delete(args.vendorId);
  },
});

/* ============================ Échéancier ============================ */

export const addPayment = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    vendorId: v.optional(v.id('coupleVendors')),
    vendorName: v.string(),
    category: v.string(),
    kind: v.union(v.literal('deposit'), v.literal('balance'), v.literal('other')),
    dueDate: v.number(),
    amountMinor: v.number(),
  },
  handler: async (ctx, args) => {
    await assertOwnedEvent(ctx, args.eventId, args.requesterId);
    assertMinor(args.amountMinor, 'AMOUNT');
    if (args.vendorId) {
      const vendor = await ctx.db.get(args.vendorId);
      if (!vendor || vendor.eventId !== args.eventId) throw new Error('VENDOR_MISMATCH');
    }
    const now = Date.now();
    return ctx.db.insert('couplePayments', {
      eventId: args.eventId,
      ...(args.vendorId ? { vendorId: args.vendorId } : {}),
      vendorName: sanitizeLabel(args.vendorName),
      category: args.category,
      kind: args.kind,
      dueDate: args.dueDate,
      amountMinor: args.amountMinor,
      paidMinor: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Règle (totalement ou partiellement) une échéance ; paidMinor = 0 ⇒ non payée. */
export const setPaymentPaid = mutation({
  args: {
    paymentId: v.id('couplePayments'),
    requesterId: v.id('users'),
    paidMinor: v.number(),
    paidAt: v.optional(v.number()),
    attachments: attachmentsValidator,
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new Error('PAYMENT_NOT_FOUND');
    await assertOwnedEvent(ctx, payment.eventId, args.requesterId);
    assertMinor(args.paidMinor, 'PAID');
    if (args.paidMinor > payment.amountMinor) throw new Error('PAID_EXCEEDS_AMOUNT');
    await ctx.db.patch(args.paymentId, {
      paidMinor: args.paidMinor,
      paidAt: args.paidMinor > 0 ? (args.paidAt ?? Date.now()) : undefined,
      ...(args.attachments !== undefined ? { attachments: args.attachments } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const removePayment = mutation({
  args: { paymentId: v.id('couplePayments'), requesterId: v.id('users') },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return;
    await assertOwnedEvent(ctx, payment.eventId, args.requesterId);
    await ctx.db.delete(args.paymentId);
  },
});

/* ============================ Budget ============================ */

export const setBudgetEnvelope = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    budgetEnvelopeMinor: v.number(),
  },
  handler: async (ctx, args) => {
    await assertOwnedEvent(ctx, args.eventId, args.requesterId);
    assertMinor(args.budgetEnvelopeMinor, 'ENVELOPE');
    await ctx.db.patch(args.eventId, { budgetEnvelopeMinor: args.budgetEnvelopeMinor });
  },
});

/* ==================== Personnalisation de l'invitation ==================== */

/**
 * Choix de la cinématique d'ouverture + musique + photo du couple de
 * l'invitation publique. Sceau (défaut) libre ; autre thème, musique ou photo
 * = feature `cinematicInvitation` (Premium). `clearMusic`/`clearPhoto`
 * retirent respectivement la musique / la photo. Owner-gated.
 */
export const setInvitationDesign = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    cinematic: v.optional(v.string()),
    music: v.optional(
      v.object({
        source: v.union(v.literal('library'), v.literal('custom')),
        trackId: v.optional(v.string()),
        s3Key: v.optional(v.string()),
        title: v.optional(v.string()),
      }),
    ),
    clearMusic: v.optional(v.boolean()),
    photo: v.optional(
      v.object({
        s3Key: v.string(),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
      }),
    ),
    clearPhoto: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const event = await assertOwnedEvent(ctx, args.eventId, args.requesterId);
    assertInvitationDesignAllowed(event, {
      cinematic: args.cinematic,
      music: args.music,
      photo: args.photo,
    });

    const patch: Partial<Doc<'events'>> = { updatedAt: Date.now() };
    if (args.cinematic !== undefined) {
      // Le sceau est le défaut historique : on ne stocke rien dans ce cas.
      patch.invitationCinematic = args.cinematic === 'seal' ? undefined : args.cinematic;
    }
    if (args.clearMusic) {
      patch.invitationMusic = undefined;
    } else if (args.music) {
      patch.invitationMusic =
        args.music.source === 'library'
          ? { source: 'library', trackId: args.music.trackId }
          : { source: 'custom', s3Key: args.music.s3Key, title: args.music.title?.slice(0, 120) };
    }
    if (args.clearPhoto) {
      patch.invitationPhoto = undefined;
    } else if (args.photo) {
      patch.invitationPhoto = {
        s3Key: args.photo.s3Key,
        width: args.photo.width,
        height: args.photo.height,
      };
    }
    await ctx.db.patch(args.eventId, patch);
    return null;
  },
});

/**
 * Déroulé de la journée (planning de cérémonie) affiché sur l'invitation.
 * Owner-gated. Sanitize + borne (≤ 20 étapes, libellés courts). Un tableau vide
 * efface le programme.
 */
export const setCeremonySchedule = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    schedule: v.array(
      v.object({
        time: v.string(),
        title: v.string(),
        note: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await assertOwnedEvent(ctx, args.eventId, args.requesterId);
    const cleaned = args.schedule
      .slice(0, 20)
      .map((s) => ({
        time: s.time.trim().slice(0, 40),
        title: s.title.trim().slice(0, 120),
        note: s.note?.trim().slice(0, 200) || undefined,
      }))
      .filter((s) => s.title.length > 0 || s.time.length > 0);
    await ctx.db.patch(args.eventId, {
      ceremonySchedule: cleaned.length > 0 ? cleaned : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Garde d'accès pour les actions d'upload des médias d'invitation (musique,
 * photo) — les actions n'ont pas de `ctx.db` : propriétaire + feature
 * `cinematicInvitation` exigés.
 */
export const assertOwnerCanCustomizeInvitation = internalQuery({
  args: { eventId: v.id('events'), requesterId: v.id('users') },
  handler: async (ctx, { eventId, requesterId }) => {
    const event = await assertOwnedEvent(ctx, eventId, requesterId);
    if (!eventHasFeature(event, 'cinematicInvitation')) throw new Error('FEATURE_LOCKED');
    return { eventId: event._id };
  },
});

/* ============================ Rétroplanning ============================ */

/** Sème le template par défaut si (et seulement si) l'event n'a aucune phase. */
export const ensureDefaultPlanning = mutation({
  args: { eventId: v.id('events'), requesterId: v.id('users') },
  handler: async (ctx, args) => {
    await assertOwnedEvent(ctx, args.eventId, args.requesterId);
    const existing = await ctx.db
      .query('couplePhases')
      .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
      .first();
    if (existing) return { seeded: false };
    const now = Date.now();
    for (let i = 0; i < DEFAULT_PLANNING.length; i++) {
      const tpl = DEFAULT_PLANNING[i]!;
      const phaseId = await ctx.db.insert('couplePhases', {
        eventId: args.eventId,
        labelKey: tpl.labelKey,
        subKey: tpl.subKey,
        order: i,
        createdAt: now,
        updatedAt: now,
      });
      for (let j = 0; j < tpl.taskKeys.length; j++) {
        await ctx.db.insert('coupleTasks', {
          eventId: args.eventId,
          phaseId,
          labelKey: tpl.taskKeys[j]!,
          status: 'todo',
          order: j,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return { seeded: true };
  },
});

export const addPhase = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    label: v.string(),
    sub: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertOwnedEvent(ctx, args.eventId, args.requesterId);
    const siblings = await ctx.db
      .query('couplePhases')
      .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
      .collect();
    const now = Date.now();
    return ctx.db.insert('couplePhases', {
      eventId: args.eventId,
      label: sanitizeLabel(args.label),
      ...(args.sub?.trim() ? { sub: args.sub.trim() } : {}),
      order: siblings.length ? Math.max(...siblings.map((p) => p.order)) + 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addTask = mutation({
  args: {
    phaseId: v.id('couplePhases'),
    requesterId: v.id('users'),
    label: v.string(),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const phase = await ctx.db.get(args.phaseId);
    if (!phase) throw new Error('PHASE_NOT_FOUND');
    await assertOwnedEvent(ctx, phase.eventId, args.requesterId);
    const siblings = await ctx.db
      .query('coupleTasks')
      .withIndex('by_phase', (q) => q.eq('phaseId', args.phaseId))
      .collect();
    const now = Date.now();
    return ctx.db.insert('coupleTasks', {
      eventId: phase.eventId,
      phaseId: args.phaseId,
      label: sanitizeLabel(args.label),
      status: 'todo',
      ...(args.dueDate !== undefined ? { dueDate: args.dueDate } : {}),
      order: siblings.length ? Math.max(...siblings.map((t) => t.order)) + 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setTaskStatus = mutation({
  args: {
    taskId: v.id('coupleTasks'),
    requesterId: v.id('users'),
    status: v.union(v.literal('todo'), v.literal('doing'), v.literal('done')),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('TASK_NOT_FOUND');
    await assertOwnedEvent(ctx, task.eventId, args.requesterId);
    await ctx.db.patch(args.taskId, { status: args.status, updatedAt: Date.now() });
  },
});

export const removeTask = mutation({
  args: { taskId: v.id('coupleTasks'), requesterId: v.id('users') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return;
    await assertOwnedEvent(ctx, task.eventId, args.requesterId);
    await ctx.db.delete(args.taskId);
  },
});

/* ============================ Plan de table (Premium) ============================ */

export const saveRoom = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    name: v.string(),
    widthM: v.number(),
    lengthM: v.number(),
    floor: v.union(
      v.literal('parquet'),
      v.literal('marble'),
      v.literal('carpet'),
      v.literal('grass'),
      v.literal('concrete'),
    ),
    elements: v.array(
      v.object({
        id: v.string(),
        kind: v.union(
          v.literal('dancefloor'),
          v.literal('stage'),
          v.literal('dj'),
          v.literal('bar'),
          v.literal('buffet'),
          v.literal('cake'),
          v.literal('photobooth'),
          v.literal('gifts'),
          v.literal('guestbook'),
          v.literal('entrance'),
          v.literal('arch'),
          v.literal('plant'),
        ),
        x: v.number(),
        y: v.number(),
        w: v.number(),
        h: v.number(),
        rotation: v.number(),
        label: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const event = await assertOwnedEvent(ctx, args.eventId, args.requesterId);
    assertSeatingFeature(event);
    if (args.widthM < 4 || args.widthM > 80 || args.lengthM < 4 || args.lengthM > 80) {
      throw new Error('INVALID_ROOM_SIZE');
    }
    if (args.elements.length > 80) throw new Error('TOO_MANY_ELEMENTS');
    const existing = await ctx.db
      .query('coupleRooms')
      .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
      .first();
    const now = Date.now();
    const doc = {
      name: sanitizeLabel(args.name, 80),
      widthM: args.widthM,
      lengthM: args.lengthM,
      floor: args.floor,
      elements: args.elements,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return ctx.db.insert('coupleRooms', { eventId: args.eventId, createdAt: now, ...doc });
  },
});

/** Crée ou met à jour une table du plan (positions en MÈTRES pour ce produit). */
export const upsertTable = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    tableId: v.optional(v.id('tables')),
    name: v.string(),
    shape: tableShapeValidator,
    capacity: v.number(),
    x: v.number(),
    y: v.number(),
    rotation: v.number(),
    honor: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await assertOwnedEvent(ctx, args.eventId, args.requesterId);
    assertSeatingFeature(event);
    if (!Number.isInteger(args.capacity) || args.capacity < 1 || args.capacity > 40) {
      throw new Error('INVALID_CAPACITY');
    }
    const now = Date.now();
    if (args.tableId) {
      const table = await ctx.db.get(args.tableId);
      if (!table || table.eventId !== args.eventId) throw new Error('TABLE_NOT_FOUND');
      // Réduire la capacité rend caduques les chaises au-delà : on les efface
      // plutôt que de laisser un invité avec une place qui n'existe plus.
      if (args.capacity < table.capacity) {
        await clearSeatsAbove(ctx, args.tableId, args.capacity, now);
      }
      await ctx.db.patch(args.tableId, {
        name: sanitizeLabel(args.name, 80),
        shape: args.shape,
        capacity: args.capacity,
        posX: args.x,
        posY: args.y,
        rotation: args.rotation,
        honor: args.honor ?? false,
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
        updatedAt: now,
      });
      return args.tableId;
    }
    const siblings = await ctx.db
      .query('tables')
      .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
      .collect();
    if (siblings.length >= 60) throw new Error('TOO_MANY_TABLES');
    return ctx.db.insert('tables', {
      eventId: args.eventId,
      name: sanitizeLabel(args.name, 80),
      shape: args.shape,
      capacity: args.capacity,
      posX: args.x,
      posY: args.y,
      rotation: args.rotation,
      honor: args.honor ?? false,
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      order: siblings.length ? Math.max(...siblings.map((t) => t.order)) + 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const removeTable = mutation({
  args: { tableId: v.id('tables'), requesterId: v.id('users') },
  handler: async (ctx, args) => {
    const table = await ctx.db.get(args.tableId);
    if (!table) return;
    const event = await assertOwnedEvent(ctx, table.eventId, args.requesterId);
    assertSeatingFeature(event);
    // Désassigne les invités posés sur cette table avant suppression.
    const seated = await ctx.db
      .query('guests')
      .withIndex('by_table', (q) => q.eq('tableId', args.tableId))
      .collect();
    const now = Date.now();
    for (const g of seated) {
      await ctx.db.patch(g._id, {
        tableId: undefined,
        seatNumber: undefined,
        seatAssignedAt: now,
        updatedAt: now,
      });
    }
    // Accompagnants placés à cette table (modèle unité-personne, cf. seating.ts).
    const companionRows = await ctx.db
      .query('tableAssignments')
      .withIndex('by_table', (q) => q.eq('tableId', args.tableId))
      .collect();
    for (const row of companionRows) {
      await ctx.db.delete(row._id);
      await ctx.db.patch(row.guestId, { seatAssignedAt: now, updatedAt: now });
    }
    await ctx.db.delete(args.tableId);
  },
});

/** Pose (ou retire, tableId=null) une invitation entière sur une table. */
export const assignGuestTable = mutation({
  args: {
    guestId: v.id('guests'),
    requesterId: v.id('users'),
    tableId: v.union(v.id('tables'), v.null()),
  },
  handler: async (ctx, args) => {
    const guest = await ctx.db.get(args.guestId);
    if (!guest) throw new Error('GUEST_NOT_FOUND');
    const event = await assertOwnedEvent(ctx, guest.eventId, args.requesterId);
    assertSeatingFeature(event);
    if (args.tableId) {
      const table = await ctx.db.get(args.tableId);
      if (!table || table.eventId !== guest.eventId) throw new Error('TABLE_NOT_FOUND');
    }
    // Changer de table invalide la chaise : un numéro conservé placerait
    // l'invité sur une place qu'il n'a jamais reçue à la nouvelle table.
    // `seatAssignedAt` alimente la file d'envoi des pass (cf. seatPass.ts).
    const now = Date.now();
    await ctx.db.patch(args.guestId, {
      tableId: args.tableId ?? undefined,
      seatNumber: args.tableId && args.tableId === guest.tableId ? guest.seatNumber : undefined,
      seatAssignedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Efface les numéros de chaise supérieurs à `capacity` sur une table (invité
 * principal via `guests.seatNumber`, accompagnants via `tableAssignments`).
 * Appelé quand la capacité baisse — sans ça un invité garderait sur son pass
 * une place que la table n'a plus.
 */
async function clearSeatsAbove(
  ctx: MutationCtx,
  tableId: Id<'tables'>,
  capacity: number,
  now: number,
): Promise<void> {
  const seated = await ctx.db
    .query('guests')
    .withIndex('by_table', (q) => q.eq('tableId', tableId))
    .collect();
  for (const g of seated) {
    if (g.seatNumber !== undefined && g.seatNumber > capacity) {
      await ctx.db.patch(g._id, { seatNumber: undefined, seatAssignedAt: now, updatedAt: now });
    }
  }
  const rows = await ctx.db
    .query('tableAssignments')
    .withIndex('by_table', (q) => q.eq('tableId', tableId))
    .collect();
  for (const row of rows) {
    if (row.seatNumber !== undefined && row.seatNumber > capacity) {
      await ctx.db.patch(row._id, { seatNumber: undefined, updatedAt: now });
      await ctx.db.patch(row.guestId, { seatAssignedAt: now, updatedAt: now });
    }
  }
}

/**
 * Compte les invités placés / déjà prévenus / à (re)notifier pour le panneau
 * de publication du plan de table.
 *
 * Un invité compte comme « placé » dès qu'il porte une table valide — les
 * accompagnants suivent leur invitation, ils ne sont jamais notifiés seuls
 * (ils n'ont pas de numéro de téléphone propre).
 */
function seatingNotificationCounts(
  guests: ReadonlyArray<Doc<'guests'>>,
  tables: ReadonlyArray<Doc<'tables'>>,
): { placedGuests: number; notified: number; needsNotify: number } {
  const known = new Set<string>(tables.map((t) => t._id));
  let placedGuests = 0;
  let notified = 0;
  let needsNotify = 0;
  for (const g of guests) {
    const placed = Boolean(g.tableId && known.has(g.tableId));
    if (!placed) continue;
    placedGuests += 1;
    if (g.seatNotifiedAt) notified += 1;
    if (needsSeatNotification(g, placed)) needsNotify += 1;
  }
  return { placedGuests, notified, needsNotify };
}
