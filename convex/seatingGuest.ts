import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { eventHasFeature } from './lib/entitlements';
import { needsSeatNotification, resolveSeatingPublication } from './lib/seatPass';

/**
 * Face **invité** du plan de placement : le « pass placement » ouvert depuis le
 * lien personnel (le même token que le QR de check-in) et la file d'envoi qui
 * alimente `seatingActions.broadcastSeatPasses`.
 *
 * Trois garde-fous, dans cet ordre, avant de laisser sortir quoi que ce soit :
 *  1. l'event porte la feature `seatingPlan` (Premium / Pro) ;
 *  2. `events.seatingConfig.published === true` — la **validation explicite**
 *     de l'organisateur. Un plan en cours d'édition n'est jamais visible, même
 *     avec un token valide ;
 *  3. l'invité est `attending`.
 *
 * Confidentialité : le pass ne renvoie **que** la tablée du porteur du token.
 * Le plan de salle expose la géométrie et le *nom* des tables (ils sont écrits
 * sur les tables physiques) mais **aucun nom d'autre invité** — un token ne
 * doit jamais devenir une fuite de la liste d'invités.
 */

/** Statut du pass, pour que la page rende un message utile plutôt qu'un 404. */
type SeatPassStatus = 'ready' | 'unpublished' | 'not_attending' | 'unplaced';

export const getSeatPassByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const guest = await ctx.db
      .query('guests')
      .withIndex('by_qr_token', (q) => q.eq('qrCodeToken', token))
      .first();
    if (!guest) return null;

    const event = await ctx.db.get(guest.eventId);
    if (!event) return null;
    if (event.status === 'cancelled' || event.status === 'archived') return null;

    const publication = resolveSeatingPublication(event.seatingConfig);
    const eventOut = {
      _id: event._id,
      title: event.title,
      coupleNames: event.coupleNames,
      eventDate: event.eventDate,
      timezone: event.timezone,
      venue: event.venue ?? null,
      theme: event.theme ?? null,
    };
    const guestOut = {
      _id: guest._id,
      fullName: guest.fullName,
      qrCodeToken: guest.qrCodeToken,
      checkedInAt: guest.checkedInAt ?? null,
      rsvpStatus: guest.rsvpStatus,
    };

    const deny = (status: SeatPassStatus) => ({
      status,
      guest: guestOut,
      event: eventOut,
      publication: { ...publication, note: null },
      members: [],
      room: null,
      tables: [],
    });

    // Feature absente du forfait → indiscernable d'un plan non publié côté
    // invité (on ne parle pas tarification à un invité).
    if (!eventHasFeature(event, 'seatingPlan')) return deny('unpublished');
    if (!publication.published) return deny('unpublished');
    if (guest.rsvpStatus !== 'attending') return deny('not_attending');

    // --- Tablée du porteur du token (lui + ses accompagnants) ---
    const assignments = await ctx.db
      .query('tableAssignments')
      .withIndex('by_guest', (q) => q.eq('guestId', guest._id))
      .collect();
    const byMember = new Map<number, Doc<'tableAssignments'>>();
    for (const row of assignments) byMember.set(row.memberIndex, row);

    const tableIds = new Set<Id<'tables'>>();
    if (guest.tableId) tableIds.add(guest.tableId);
    for (const row of assignments) tableIds.add(row.tableId);
    if (tableIds.size === 0) return deny('unplaced');

    const tableDocs = new Map<string, Doc<'tables'>>();
    for (const id of tableIds) {
      const table = await ctx.db.get(id);
      // Table supprimée entre-temps : on ignore, la personne repasse « non placée ».
      if (table && table.eventId === event._id) tableDocs.set(id, table);
    }
    if (tableDocs.size === 0) return deny('unplaced');

    const seatOf = (tableId: Id<'tables'> | undefined, seatNumber: number | undefined) => {
      const table = tableId ? tableDocs.get(tableId) : undefined;
      return {
        tableName: table ? table.name : null,
        tableId: table ? table._id : null,
        // Numérotation 'table' → on masque la chaise même si elle est stockée.
        seatNumber: table && publication.numbering === 'seat' ? (seatNumber ?? null) : null,
      };
    };

    const members = [
      {
        memberIndex: 0,
        fullName: guest.fullName,
        ...seatOf(guest.tableId, guest.seatNumber),
      },
      ...(guest.plusOnesNames ?? []).map((name, k) => {
        const row = byMember.get(k + 1);
        return {
          memberIndex: k + 1,
          fullName: name || `${guest.fullName} +${k + 1}`,
          ...seatOf(row?.tableId, row?.seatNumber),
        };
      }),
    ];
    if (members.every((m) => m.tableName === null)) return deny('unplaced');

    // --- Plan de salle (produit couple uniquement) ---
    // `tables.posX/posY` est en MÈTRES quand une `coupleRooms` existe, en px
    // canvas côté board agence : on ne joint donc le plan que si la salle
    // existe, ce qui lève toute ambiguïté d'unité.
    const room = publication.showRoomPlan
      ? await ctx.db
          .query('coupleRooms')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .first()
      : null;

    const mine = new Set(members.map((m) => m.tableId).filter((id): id is Id<'tables'> => !!id));
    const tables = room
      ? (
          await ctx.db
            .query('tables')
            .withIndex('by_event', (q) => q.eq('eventId', event._id))
            .collect()
        )
          .filter((t) => t.posX != null && t.posY != null)
          .sort((a, b) => a.order - b.order)
          .map((t) => ({
            _id: t._id,
            name: t.name,
            shape: t.shape ?? ('round' as const),
            capacity: t.capacity,
            x: t.posX!,
            y: t.posY!,
            rotation: t.rotation ?? 0,
            honor: t.honor === true,
            mine: mine.has(t._id),
          }))
      : [];

    return {
      status: 'ready' as SeatPassStatus,
      guest: guestOut,
      event: eventOut,
      publication,
      members,
      room: room
        ? {
            name: room.name,
            widthM: room.widthM,
            lengthM: room.lengthM,
            floor: room.floor,
            elements: room.elements,
          }
        : null,
      tables,
    };
  },
});

/**
 * File d'envoi des pass : invités présents, placés, et jamais prévenus ou dont
 * la place a bougé depuis le dernier envoi (cf. `needsSeatNotification`).
 *
 * `force: true` renvoie tous les invités placés et présents — pour un renvoi
 * intégral demandé explicitement par l'organisateur.
 */
export const listSeatPassRecipients = internalQuery({
  args: { eventId: v.id('events'), force: v.optional(v.boolean()) },
  handler: async (ctx, { eventId, force }) => {
    const guests = await ctx.db
      .query('guests')
      .withIndex('by_event_rsvp', (q) => q.eq('eventId', eventId).eq('rsvpStatus', 'attending'))
      .collect();
    const assignments = await ctx.db
      .query('tableAssignments')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    const placedByCompanion = new Set<string>(assignments.map((r) => r.guestId));

    const tableNames = new Map<string, string>();
    for (const t of await ctx.db
      .query('tables')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect()) {
      tableNames.set(t._id, t.name);
    }
    const companionTable = new Map<string, Doc<'tableAssignments'>[]>();
    for (const row of assignments) {
      const arr = companionTable.get(row.guestId) ?? [];
      arr.push(row);
      companionTable.set(row.guestId, arr);
    }

    const out = [];
    for (const g of guests) {
      const placed = Boolean(g.tableId) || placedByCompanion.has(g._id);
      if (!placed) continue;
      if (!force && !needsSeatNotification(g, placed)) continue;
      const seats: Array<{
        fullName: string;
        tableName: string | null;
        seatNumber: number | null;
      }> = [
        {
          fullName: g.fullName,
          tableName: g.tableId ? (tableNames.get(g.tableId) ?? null) : null,
          seatNumber: g.seatNumber ?? null,
        },
      ];
      (g.plusOnesNames ?? []).forEach((name, k) => {
        const row = (companionTable.get(g._id) ?? []).find((r) => r.memberIndex === k + 1);
        seats.push({
          fullName: name || `${g.fullName} +${k + 1}`,
          tableName: row ? (tableNames.get(row.tableId) ?? null) : null,
          seatNumber: row?.seatNumber ?? null,
        });
      });
      out.push({
        _id: g._id,
        fullName: g.fullName,
        phone: g.phone ?? null,
        email: g.email ?? null,
        qrCodeToken: g.qrCodeToken,
        invitationChannel: g.invitationChannel ?? null,
        seats,
      });
    }
    return out;
  },
});

/** Marque un pass comme envoyé — idempotence de la file d'envoi. */
export const markSeatNotified = internalMutation({
  args: {
    guestId: v.id('guests'),
    channel: v.union(v.literal('whatsapp'), v.literal('email'), v.literal('sms')),
  },
  handler: async (ctx, { guestId, channel }) => {
    const now = Date.now();
    await ctx.db.patch(guestId, {
      seatNotifiedAt: now,
      seatNotifiedChannel: channel,
      updatedAt: now,
    });
  },
});

/** Event + publication, pour l'action de broadcast (qui n'accède pas à `ctx.db`). */
export const getEventForSeatBroadcast = internalQuery({
  args: { eventId: v.id('events'), requesterId: v.id('users') },
  handler: async (ctx, { eventId, requesterId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return null;
    let allowed = event.ownerId === requesterId;
    if (!allowed) {
      const collab = await ctx.db
        .query('eventCollaborators')
        .withIndex('by_event_user', (q) => q.eq('eventId', eventId).eq('userId', requesterId))
        .first();
      allowed = collab !== null;
    }
    if (!allowed) return null;
    // Locale des messages = celle du propriétaire de l'event (même règle que
    // le cron de rappels) : l'invité n'a pas de préférence stockée.
    const owner = await ctx.db.get(event.ownerId);
    return {
      _id: event._id,
      status: event.status,
      ownerLocale: owner?.locale ?? null,
      coupleNames: event.coupleNames,
      eventDate: event.eventDate,
      timezone: event.timezone,
      venue: event.venue ?? null,
      hasSeating: eventHasFeature(event, 'seatingPlan'),
      publication: resolveSeatingPublication(event.seatingConfig),
    };
  },
});
