import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { eventHasFeature } from './lib/entitlements';
import { autoPlace } from './lib/autoplace';
import {
  normalizeSeatNumber,
  planSeatMove,
  planTableNumbering,
  seatConflicts,
  type NumberingMode,
  type SeatNumberUnit,
} from './lib/seatNumbers';
import { needsSeatNotification, resolveSeatingPublication } from './lib/seatPass';

/**
 * Plan de table / seating. Feature Premium + Pro (`seatingPlan`) — Essentiel
 * exclu.
 *
 * Modèle **unité-personne** (v2.1) : chaque place se gère par personne.
 *  - L'invité principal (memberIndex 0) est porté par `guests.tableId`
 *    (rétro-compat V1/V2).
 *  - Chaque accompagnant `plusOnesNames[k]` = memberIndex `k + 1`, placé
 *    **indépendamment** via la table `tableAssignments` (absence de row = non
 *    placé). Une personne = une place.
 *
 * Toutes les mutations / la query vérifient : (1) l'appelant gère l'event
 * (owner ou collaborateur), (2) l'event a l'entitlement `seatingPlan`. Sinon
 * throw `FORBIDDEN` / `FEATURE_NOT_IN_PLAN`.
 */

const DEFAULT_CAPACITY = 8;
const MAX_CAPACITY = 30;

/** Unité-personne placeable (invité principal ou accompagnant). */
interface SeatUnit {
  _id: string; // `${guestId}` (principal) ou `${guestId}:${memberIndex}` (accompagnant)
  guestId: Id<'guests'>;
  memberIndex: number;
  fullName: string;
  hostName?: string; // nom de l'invité principal (pour les accompagnants)
  seats: 1;
  plusOnesNames: string[]; // toujours [] en modèle unité-personne (compat type UI)
  category?: string;
  tableId: Id<'tables'> | null;
  /** Chaise nominative à la table, `null` = placé sans numéro. */
  seatNumber: number | null;
}

function unitId(guestId: Id<'guests'>, memberIndex: number): string {
  return memberIndex === 0 ? guestId : `${guestId}:${memberIndex}`;
}

function parseUnitId(id: string): { guestId: Id<'guests'>; memberIndex: number } {
  const sep = id.lastIndexOf(':');
  if (sep === -1) return { guestId: id as Id<'guests'>, memberIndex: 0 };
  return {
    guestId: id.slice(0, sep) as Id<'guests'>,
    memberIndex: Number.parseInt(id.slice(sep + 1), 10) || 0,
  };
}

/**
 * Construit toutes les unités-personnes des invités confirmés, avec leur table
 * résolue (principal ← guests.tableId ; accompagnant ← tableAssignments).
 */
function buildUnits(
  guests: Doc<'guests'>[],
  assignmentMap: Map<string, Doc<'tableAssignments'>>,
): SeatUnit[] {
  const units: SeatUnit[] = [];
  for (const g of guests) {
    if (g.rsvpStatus !== 'attending') continue;
    const category = g.category;
    units.push({
      _id: unitId(g._id, 0),
      guestId: g._id,
      memberIndex: 0,
      fullName: g.fullName,
      seats: 1,
      plusOnesNames: [],
      ...(category ? { category } : {}),
      tableId: g.tableId ?? null,
      seatNumber: g.tableId ? (g.seatNumber ?? null) : null,
    });
    const plusOnes = g.plusOnesNames ?? [];
    for (let k = 0; k < plusOnes.length; k += 1) {
      const memberIndex = k + 1;
      const row = assignmentMap.get(unitId(g._id, memberIndex));
      units.push({
        _id: unitId(g._id, memberIndex),
        guestId: g._id,
        memberIndex,
        fullName: plusOnes[k] ?? `${g.fullName} +${memberIndex}`,
        hostName: g.fullName,
        seats: 1,
        plusOnesNames: [],
        ...(category ? { category } : {}),
        tableId: row?.tableId ?? null,
        seatNumber: row?.seatNumber ?? null,
      });
    }
  }
  return units;
}

async function requireSeatingAccess(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'events'>,
  requesterId: Id<'users'>,
): Promise<Doc<'events'>> {
  const event = await ctx.db.get(eventId);
  if (!event) throw new Error('EVENT_NOT_FOUND');
  let allowed = event.ownerId === requesterId;
  if (!allowed) {
    const collab = await ctx.db
      .query('eventCollaborators')
      .withIndex('by_event_user', (q) => q.eq('eventId', eventId).eq('userId', requesterId))
      .first();
    allowed = collab !== null;
  }
  if (!allowed) throw new Error('FORBIDDEN');
  if (!eventHasFeature(event, 'seatingPlan')) throw new Error('FEATURE_NOT_IN_PLAN');
  return event;
}

async function requireTableAccess(
  ctx: MutationCtx,
  tableId: Id<'tables'>,
  requesterId: Id<'users'>,
): Promise<Doc<'tables'>> {
  const table = await ctx.db.get(tableId);
  if (!table) throw new Error('TABLE_NOT_FOUND');
  await requireSeatingAccess(ctx, table.eventId, requesterId);
  return table;
}

/**
 * Persiste l'assignation d'une unité-personne (principal → `guests.tableId` ;
 * accompagnant → `tableAssignments` upsert/delete), numéro de chaise compris.
 *
 * Retirer quelqu'un d'une table (`tableId: null`) **efface toujours** son
 * numéro : un numéro orphelin ressortirait à la prochaine assignation et
 * placerait la personne sur une chaise qu'elle n'a jamais reçue.
 *
 * Estampille `guests.seatAssignedAt` sur la tablée entière (y compris quand
 * c'est un accompagnant qui bouge) : c'est ce timestamp que la file d'envoi
 * compare à `seatNotifiedAt` pour savoir qui doit être re-notifié.
 */
async function persistSeat(
  ctx: MutationCtx,
  eventId: Id<'events'>,
  guestId: Id<'guests'>,
  memberIndex: number,
  tableId: Id<'tables'> | null,
  now: number,
  seatNumber: number | null = null,
): Promise<void> {
  const seat = tableId === null ? null : seatNumber;
  if (memberIndex === 0) {
    await ctx.db.patch(guestId, {
      tableId: tableId ?? undefined,
      seatNumber: seat ?? undefined,
      seatAssignedAt: now,
      updatedAt: now,
    });
    return;
  }
  const existing = await ctx.db
    .query('tableAssignments')
    .withIndex('by_guest_member', (q) => q.eq('guestId', guestId).eq('memberIndex', memberIndex))
    .first();
  if (tableId === null) {
    if (existing) await ctx.db.delete(existing._id);
  } else if (existing) {
    await ctx.db.patch(existing._id, { tableId, seatNumber: seat ?? undefined, updatedAt: now });
  } else {
    await ctx.db.insert('tableAssignments', {
      eventId,
      guestId,
      memberIndex,
      tableId,
      ...(seat === null ? {} : { seatNumber: seat }),
      createdAt: now,
      updatedAt: now,
    });
  }
  await ctx.db.patch(guestId, { seatAssignedAt: now, updatedAt: now });
}

/** Écrit le seul numéro de chaise d'une unité déjà posée à une table. */
async function persistSeatNumber(
  ctx: MutationCtx,
  guestId: Id<'guests'>,
  memberIndex: number,
  seatNumber: number | null,
  now: number,
): Promise<void> {
  if (memberIndex === 0) {
    await ctx.db.patch(guestId, {
      seatNumber: seatNumber ?? undefined,
      seatAssignedAt: now,
      updatedAt: now,
    });
    return;
  }
  const existing = await ctx.db
    .query('tableAssignments')
    .withIndex('by_guest_member', (q) => q.eq('guestId', guestId).eq('memberIndex', memberIndex))
    .first();
  if (!existing) return;
  await ctx.db.patch(existing._id, { seatNumber: seatNumber ?? undefined, updatedAt: now });
  await ctx.db.patch(guestId, { seatAssignedAt: now, updatedAt: now });
}

/**
 * Passe de numérotation sur les tables indiquées (toutes si `tableIds` est
 * omis). `mode: 'fill'` respecte les chaises déjà posées à la main et se
 * contente de combler les trous — donc idempotent, on peut l'enchaîner après
 * un placement automatique sans écraser le travail de l'organisateur.
 */
async function renumberTables(
  ctx: MutationCtx,
  eventId: Id<'events'>,
  mode: NumberingMode,
  tableIds?: ReadonlyArray<Id<'tables'>>,
): Promise<number> {
  const tables = await ctx.db
    .query('tables')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .collect();
  const scope = tableIds ? new Set<string>(tableIds) : null;
  const guests = await ctx.db
    .query('guests')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .collect();
  const rows = await ctx.db
    .query('tableAssignments')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .collect();
  const assignmentMap = new Map<string, Doc<'tableAssignments'>>();
  for (const row of rows) assignmentMap.set(unitId(row.guestId, row.memberIndex), row);

  const units = buildUnits(guests, assignmentMap);
  const byTable = new Map<string, SeatUnit[]>();
  for (const u of units) {
    if (!u.tableId) continue;
    if (scope && !scope.has(u.tableId)) continue;
    const arr = byTable.get(u.tableId) ?? [];
    arr.push(u);
    byTable.set(u.tableId, arr);
  }

  const now = Date.now();
  let applied = 0;
  for (const table of tables) {
    const seated = byTable.get(table._id);
    if (!seated || seated.length === 0) continue;
    const changes = planTableNumbering(seated.map(toNumberUnit), table.capacity, mode);
    for (const change of changes) {
      const { guestId, memberIndex } = parseUnitId(change._id);
      await persistSeatNumber(ctx, guestId, memberIndex, change.seatNumber, now);
      applied += 1;
    }
  }
  return applied;
}

/** Projection d'une unité vers le modèle attendu par `lib/seatNumbers`. */
function toNumberUnit(u: SeatUnit): SeatNumberUnit {
  return { _id: u._id, partyKey: u.guestId, seatNumber: u.seatNumber };
}

export const createTable = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    name: v.optional(v.string()),
    capacity: v.optional(v.number()),
  },
  handler: async (ctx, { eventId, requesterId, name, capacity }) => {
    await requireSeatingAccess(ctx, eventId, requesterId);
    const existing = await ctx.db
      .query('tables')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    const order = existing.length;
    const now = Date.now();
    const tableId = await ctx.db.insert('tables', {
      eventId,
      name: name?.trim() || `Table ${order + 1}`,
      capacity:
        capacity && capacity > 0 ? Math.min(Math.round(capacity), MAX_CAPACITY) : DEFAULT_CAPACITY,
      order,
      createdAt: now,
      updatedAt: now,
    });
    return { tableId };
  },
});

export const updateTable = mutation({
  args: {
    tableId: v.id('tables'),
    requesterId: v.id('users'),
    name: v.optional(v.string()),
    capacity: v.optional(v.number()),
    shape: v.optional(v.union(v.literal('round'), v.literal('rect'))),
    posX: v.optional(v.number()),
    posY: v.optional(v.number()),
  },
  handler: async (ctx, { tableId, requesterId, name, capacity, shape, posX, posY }) => {
    await requireTableAccess(ctx, tableId, requesterId);
    const patch: Partial<Doc<'tables'>> = { updatedAt: Date.now() };
    if (name !== undefined && name.trim()) patch.name = name.trim();
    if (capacity !== undefined && capacity > 0) {
      patch.capacity = Math.min(Math.round(capacity), MAX_CAPACITY);
    }
    if (shape !== undefined) patch.shape = shape;
    if (posX !== undefined) patch.posX = Math.max(0, Math.min(Math.round(posX), 4000));
    if (posY !== undefined) patch.posY = Math.max(0, Math.min(Math.round(posY), 4000));
    await ctx.db.patch(tableId, patch);
    return { ok: true as const };
  },
});

export const deleteTable = mutation({
  args: { tableId: v.id('tables'), requesterId: v.id('users') },
  handler: async (ctx, { tableId, requesterId }) => {
    await requireTableAccess(ctx, tableId, requesterId);
    const now = Date.now();
    // Désassigne les invités principaux placés ici (guests.tableId).
    const mainOccupants = await ctx.db
      .query('guests')
      .withIndex('by_table', (q) => q.eq('tableId', tableId))
      .collect();
    for (const g of mainOccupants) {
      await ctx.db.patch(g._id, {
        tableId: undefined,
        seatNumber: undefined,
        seatAssignedAt: now,
        updatedAt: now,
      });
    }
    // Supprime les assignations d'accompagnants vers cette table.
    const rows = await ctx.db
      .query('tableAssignments')
      .withIndex('by_table', (q) => q.eq('tableId', tableId))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
      await ctx.db.patch(row.guestId, { seatAssignedAt: now, updatedAt: now });
    }
    await ctx.db.delete(tableId);
    return { ok: true as const, unassigned: mainOccupants.length + rows.length };
  },
});

/**
 * Assigne une **personne** (invité principal `memberIndex: 0` ou accompagnant
 * `memberIndex >= 1`) à une table — ou `tableId: null` pour la désassigner.
 * Cœur du drag-and-drop par personne.
 */
export const assignSeat = mutation({
  args: {
    eventId: v.id('events'),
    guestId: v.id('guests'),
    memberIndex: v.number(),
    tableId: v.union(v.id('tables'), v.null()),
    /**
     * Chaise visée à la table (1-basée). Omis = on garde/retire simplement la
     * table sans toucher au numéro. `null` = poser à la table sans chaise.
     * Si la chaise est déjà occupée, les deux personnes sont **échangées**.
     */
    seatNumber: v.optional(v.union(v.number(), v.null())),
    requesterId: v.id('users'),
  },
  handler: async (ctx, { eventId, guestId, memberIndex, tableId, seatNumber, requesterId }) => {
    await requireSeatingAccess(ctx, eventId, requesterId);
    const guest = await ctx.db.get(guestId);
    if (!guest || guest.eventId !== eventId) throw new Error('GUEST_NOT_FOUND');
    const index = Math.max(0, Math.round(memberIndex));
    const now = Date.now();

    if (tableId === null) {
      await persistSeat(ctx, eventId, guestId, index, null, now);
      return { ok: true as const, seatNumber: null };
    }

    const table = await ctx.db.get(tableId);
    if (!table || table.eventId !== eventId) throw new Error('TABLE_NOT_FOUND');
    const movingUnitId = unitId(guestId, index);

    // Chemin rapide du drag-and-drop (aucune chaise demandée) : on conserve le
    // numéro seulement si la personne était DÉJÀ à cette table, sinon on part
    // sans chaise. Aucun échange possible ici, donc pas besoin de charger les
    // occupants — ce chemin est appelé à chaque glisser-déposer.
    if (seatNumber === undefined) {
      const current = await currentSeat(ctx, guestId, index);
      const keep = current.tableId === tableId ? current.seatNumber : null;
      await persistSeat(ctx, eventId, guestId, index, tableId, now, keep);
      return { ok: true as const, seatNumber: keep };
    }

    // Chaise explicitement demandée : il faut les occupants pour détecter la
    // place déjà prise et décider de l'échange.
    const occupants = await tableOccupants(ctx, eventId, tableId);
    const requested = normalizeSeatNumber(seatNumber, table.capacity);
    const changes = planSeatMove(
      occupants.map(toNumberUnit),
      movingUnitId,
      requested,
      table.capacity,
    );
    // Le déplacé change de table (ou reste) : une seule écriture porte les deux.
    await persistSeat(ctx, eventId, guestId, index, tableId, now, requested);
    for (const change of changes) {
      if (change._id === movingUnitId) continue;
      const target = parseUnitId(change._id);
      await persistSeatNumber(ctx, target.guestId, target.memberIndex, change.seatNumber, now);
    }
    return { ok: true as const, seatNumber: requested };
  },
});

/** Table + chaise actuelles d'une unité-personne, en lectures indexées. */
async function currentSeat(
  ctx: MutationCtx,
  guestId: Id<'guests'>,
  memberIndex: number,
): Promise<{ tableId: Id<'tables'> | null; seatNumber: number | null }> {
  if (memberIndex === 0) {
    const guest = await ctx.db.get(guestId);
    return { tableId: guest?.tableId ?? null, seatNumber: guest?.seatNumber ?? null };
  }
  const row = await ctx.db
    .query('tableAssignments')
    .withIndex('by_guest_member', (q) => q.eq('guestId', guestId).eq('memberIndex', memberIndex))
    .first();
  return { tableId: row?.tableId ?? null, seatNumber: row?.seatNumber ?? null };
}

/** Unités-personnes actuellement posées à une table donnée. */
async function tableOccupants(
  ctx: MutationCtx | QueryCtx,
  eventId: Id<'events'>,
  tableId: Id<'tables'>,
): Promise<SeatUnit[]> {
  const guests = await ctx.db
    .query('guests')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .collect();
  const rows = await ctx.db
    .query('tableAssignments')
    .withIndex('by_table', (q) => q.eq('tableId', tableId))
    .collect();
  const assignmentMap = new Map<string, Doc<'tableAssignments'>>();
  for (const row of rows) assignmentMap.set(unitId(row.guestId, row.memberIndex), row);
  return buildUnits(guests, assignmentMap).filter((u) => u.tableId === tableId);
}

/**
 * Placement automatique : assigne toutes les **personnes** non placées
 * (invités + accompagnants) aux tables, en regroupant par catégorie et en
 * gardant une même « party » ensemble par défaut (unités du même invité
 * consécutives). Crée les tables manquantes. Ne touche que les non-placés.
 */
export const autoAssignGuests = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    // 'unplaced' (défaut) : ne touche qu'aux personnes non placées.
    // 'all' : vide d'abord toutes les assignations puis replace tout le monde.
    mode: v.optional(v.union(v.literal('unplaced'), v.literal('all'))),
    settings: v.optional(
      v.object({
        groupByCategory: v.optional(v.boolean()),
        keepGroupsTogether: v.optional(v.boolean()),
        balanceTables: v.optional(v.boolean()),
        createTables: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { eventId, requesterId, mode, settings }) => {
    await requireSeatingAccess(ctx, eventId, requesterId);
    const now = Date.now();
    const replaceAll = mode === 'all';

    const tables = await ctx.db
      .query('tables')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    let guests = await ctx.db
      .query('guests')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    let assignmentRows = await ctx.db
      .query('tableAssignments')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();

    if (replaceAll) {
      // Tout replacer : on désassigne d'abord tout le monde (principaux + accompagnants).
      for (const g of guests) {
        if (g.tableId) await ctx.db.patch(g._id, { tableId: undefined, updatedAt: now });
      }
      for (const row of assignmentRows) await ctx.db.delete(row._id);
      guests = guests.map((g) => ({ ...g, tableId: undefined }));
      assignmentRows = [];
    }

    const assignmentMap = new Map<string, Doc<'tableAssignments'>>();
    for (const row of assignmentRows) assignmentMap.set(unitId(row.guestId, row.memberIndex), row);

    const allUnits = buildUnits(guests, assignmentMap);
    const occupancy = new Map<string, number>();
    const unassigned: Array<{ _id: string; seats: number; category?: string }> = [];
    for (const u of allUnits) {
      if (u.tableId) {
        occupancy.set(u.tableId, (occupancy.get(u.tableId) ?? 0) + 1);
      } else {
        unassigned.push({ _id: u._id, seats: 1, ...(u.category ? { category: u.category } : {}) });
      }
    }
    if (unassigned.length === 0) {
      // Rien à placer, mais des tables peuvent avoir des chaises non numérotées
      // (import, plan hérité) : la passe 'fill' comble sans rien écraser.
      const numbered = await renumberTables(ctx, eventId, 'fill');
      return { assigned: 0, tablesCreated: 0, unplaced: 0, numbered };
    }

    const placeTables = tables.map((t) => ({
      _id: t._id,
      remaining: Math.max(0, t.capacity - (occupancy.get(t._id) ?? 0)),
    }));
    const result = autoPlace(unassigned, placeTables, DEFAULT_CAPACITY, settings ?? {});

    let created = 0;
    let assigned = 0;
    let order = tables.length;
    for (const nt of result.newTables) {
      const idx = order;
      const newTableId = await ctx.db.insert('tables', {
        eventId,
        name: `Table ${idx + 1}`,
        capacity: Math.min(nt.capacity, MAX_CAPACITY),
        shape: 'round' as const,
        posX: 40 + (idx % 4) * 210,
        posY: 40 + Math.floor(idx / 4) * 190,
        order: idx,
        createdAt: now,
        updatedAt: now,
      });
      order += 1;
      created += 1;
      for (const id of nt.guestIds) {
        const { guestId, memberIndex } = parseUnitId(id);
        await persistSeat(ctx, eventId, guestId, memberIndex, newTableId, now);
        assigned += 1;
      }
    }
    for (const a of result.assignments) {
      const { guestId, memberIndex } = parseUnitId(a.guestId);
      await persistSeat(ctx, eventId, guestId, memberIndex, a.tableId as Id<'tables'>, now);
      assigned += 1;
    }

    // Les nouvelles personnes arrivent sans chaise : on numérote dans la
    // foulée pour que l'organisateur n'ait pas à déclencher une 2e action.
    const numbered = await renumberTables(ctx, eventId, 'fill');

    return { assigned, tablesCreated: created, unplaced: result.unplaced.length, numbered };
  },
});

/**
 * Numérote les chaises — toutes les tables, ou une seule (`tableId`).
 *
 * `mode: 'fill'` (défaut) respecte les numéros posés à la main et ne comble
 * que les trous ; `mode: 'renumber'` repart de 1 en groupant les tablées.
 * Dans les deux cas les membres d'une même invitation restent contigus.
 */
export const autoNumberSeats = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    tableId: v.optional(v.id('tables')),
    mode: v.optional(v.union(v.literal('fill'), v.literal('renumber'))),
  },
  handler: async (ctx, { eventId, requesterId, tableId, mode }) => {
    await requireSeatingAccess(ctx, eventId, requesterId);
    if (tableId) {
      const table = await ctx.db.get(tableId);
      if (!table || table.eventId !== eventId) throw new Error('TABLE_NOT_FOUND');
    }
    const numbered = await renumberTables(
      ctx,
      eventId,
      mode ?? 'fill',
      tableId ? [tableId] : undefined,
    );
    return { numbered };
  },
});

/**
 * Publie (ou dépublie) le plan de placement côté invité — **la validation**
 * explicite de l'organisateur avant tout envoi.
 *
 * Tant que ce flag est faux, `seatingGuest.getSeatPassByToken` renvoie `null`
 * même avec un token valide : aucun invité ne peut découvrir un plan en cours
 * d'édition. Dépublier remet immédiatement les pass hors ligne (un lien déjà
 * envoyé cesse d'afficher une place obsolète).
 */
export const setSeatingPublication = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    published: v.boolean(),
    numbering: v.optional(v.union(v.literal('table'), v.literal('seat'))),
    showRoomPlan: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, requesterId, published, numbering, showRoomPlan, note }) => {
    const event = await requireSeatingAccess(ctx, eventId, requesterId);
    const previous = event.seatingConfig;
    const now = Date.now();
    const trimmed = note?.trim();
    await ctx.db.patch(eventId, {
      seatingConfig: {
        published,
        // On garde la date de première publication tant qu'on ne dépublie pas,
        // pour afficher « publié le … » sans le réécrire à chaque réglage.
        ...(published
          ? {
              publishedAt: previous?.published ? (previous.publishedAt ?? now) : now,
              publishedBy: requesterId,
            }
          : {}),
        numbering: numbering ?? previous?.numbering ?? 'seat',
        showRoomPlan: showRoomPlan ?? previous?.showRoomPlan ?? true,
        ...(trimmed === undefined
          ? previous?.note
            ? { note: previous.note }
            : {}
          : trimmed
            ? { note: trimmed.slice(0, 280) }
            : {}),
      },
      updatedAt: now,
    });
    return { ok: true as const, published };
  },
});

export const getSeatingPlan = query({
  args: { eventId: v.id('events'), requesterId: v.id('users') },
  handler: async (ctx, { eventId, requesterId }) => {
    const event = await requireSeatingAccess(ctx, eventId, requesterId);

    const tablesRaw = await ctx.db
      .query('tables')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    const guests = await ctx.db
      .query('guests')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    const assignmentRows = await ctx.db
      .query('tableAssignments')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    const assignmentMap = new Map<string, Doc<'tableAssignments'>>();
    for (const row of assignmentRows) assignmentMap.set(unitId(row.guestId, row.memberIndex), row);

    type UnitOut = Omit<SeatUnit, 'tableId'>;
    const toOut = (u: SeatUnit): UnitOut => ({
      _id: u._id,
      guestId: u.guestId,
      memberIndex: u.memberIndex,
      fullName: u.fullName,
      seats: u.seats,
      plusOnesNames: u.plusOnesNames,
      seatNumber: u.seatNumber,
      ...(u.hostName ? { hostName: u.hostName } : {}),
      ...(u.category ? { category: u.category } : {}),
    });

    const allUnits = buildUnits(guests, assignmentMap);
    const byTable = new Map<string, UnitOut[]>();
    const unassigned: UnitOut[] = [];
    /** guestId → la tablée a-t-elle au moins une personne placée ? */
    const placedParty = new Set<string>();
    for (const u of allUnits) {
      if (u.tableId) {
        const arr = byTable.get(u.tableId) ?? [];
        arr.push(toOut(u));
        byTable.set(u.tableId, arr);
        placedParty.add(u.guestId);
      } else {
        unassigned.push(toOut(u));
      }
    }

    const tables = tablesRaw
      .sort((a, b) => a.order - b.order)
      .map((t) => {
        const assigned = (byTable.get(t._id) ?? []).sort(bySeatThenName);
        const occupancy = assigned.reduce((sum, u) => sum + u.seats, 0);
        return {
          _id: t._id,
          name: t.name,
          capacity: t.capacity,
          shape: t.shape,
          posX: t.posX,
          posY: t.posY,
          order: t.order,
          assigned,
          occupancy,
          overCapacity: occupancy > t.capacity,
          // Deux personnes sur la même chaise : à corriger avant publication.
          seatConflicts: seatConflicts(
            assigned.map((u) => ({ _id: u._id, partyKey: u.guestId, seatNumber: u.seatNumber })),
          ),
          unnumbered: assigned.filter((u) => u.seatNumber === null).length,
        };
      });

    const unassignedSeats = unassigned.reduce((sum, u) => sum + u.seats, 0);
    const seatedSeats = tables.reduce((sum, t) => sum + t.occupancy, 0);

    // File d'envoi des pass : invités présents, placés, jamais prévenus ou
    // dont la place a bougé depuis la dernière notification.
    let notified = 0;
    let needsNotify = 0;
    let placedGuests = 0;
    for (const g of guests) {
      const placed = placedParty.has(g._id);
      if (!placed) continue;
      placedGuests += 1;
      if (g.seatNotifiedAt) notified += 1;
      if (needsSeatNotification(g, placed)) needsNotify += 1;
    }

    return {
      tables,
      unassigned,
      publication: resolveSeatingPublication(event.seatingConfig),
      notifications: { placedGuests, notified, needsNotify },
      stats: {
        tableCount: tables.length,
        totalCapacity: tables.reduce((sum, t) => sum + t.capacity, 0),
        seatedSeats,
        unassignedSeats,
        attendingParties: tables.reduce((n, t) => n + t.assigned.length, 0) + unassigned.length,
        seatConflicts: tables.reduce((n, t) => n + t.seatConflicts.length, 0),
        unnumbered: tables.reduce((n, t) => n + t.unnumbered, 0),
      },
    };
  },
});

/** Ordre d'affichage à une table : chaises numérotées d'abord, puis alpha. */
function bySeatThenName(
  a: { seatNumber: number | null; fullName: string },
  b: { seatNumber: number | null; fullName: string },
): number {
  if (a.seatNumber !== null && b.seatNumber !== null) return a.seatNumber - b.seatNumber;
  if (a.seatNumber !== null) return -1;
  if (b.seatNumber !== null) return 1;
  return a.fullName.localeCompare(b.fullName);
}
