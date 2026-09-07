'use server';

import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import type { SeatingPlan } from '@/lib/seating/board';

export type SeatingActionResult = { ok: true } | { ok: false; error: string };

const KNOWN_ERRORS = [
  'FEATURE_NOT_IN_PLAN',
  'FORBIDDEN',
  'EVENT_NOT_FOUND',
  'EVENT_NOT_FOUND_OR_FORBIDDEN',
  'TABLE_NOT_FOUND',
  'GUEST_NOT_FOUND',
  'SEATING_NOT_PUBLISHED',
] as const;

function mapError(err: unknown): { ok: false; error: string } {
  const message = err instanceof Error ? err.message : 'UNKNOWN';
  const hit = KNOWN_ERRORS.find((code) => message.includes(code));
  return { ok: false, error: hit ?? 'UNKNOWN' };
}

export async function createTableAction(
  eventId: string,
  input?: { name?: string; capacity?: number },
): Promise<SeatingActionResult & { tableId?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    const res = await convex.mutation(convexApi.createTable, {
      eventId,
      requesterId: session.userId,
      ...(input?.name ? { name: input.name } : {}),
      ...(input?.capacity ? { capacity: input.capacity } : {}),
    });
    return { ok: true, tableId: res.tableId };
  } catch (err) {
    return mapError(err);
  }
}

export async function updateTableAction(
  tableId: string,
  input: {
    name?: string;
    capacity?: number;
    shape?: 'round' | 'rect';
    posX?: number;
    posY?: number;
  },
): Promise<SeatingActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.updateTable, {
      tableId,
      requesterId: session.userId,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.shape !== undefined ? { shape: input.shape } : {}),
      ...(input.posX !== undefined ? { posX: input.posX } : {}),
      ...(input.posY !== undefined ? { posY: input.posY } : {}),
    });
    return { ok: true };
  } catch (err) {
    return mapError(err);
  }
}

/**
 * Placement automatique : assigne les invités non placés + crée les tables
 * nécessaires côté serveur, puis renvoie le plan rafraîchi pour que le board
 * remplace son état local (opération en masse → vérité serveur).
 */
export interface AutoPlaceSettings {
  groupByCategory?: boolean;
  keepGroupsTogether?: boolean;
  balanceTables?: boolean;
  createTables?: boolean;
}

export async function autoAssignGuestsAction(
  eventId: string,
  opts?: { mode?: 'unplaced' | 'all'; settings?: AutoPlaceSettings },
): Promise<
  | { ok: true; assigned: number; tablesCreated: number; unplaced: number; plan: SeatingPlan }
  | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    const res = await convex.mutation(convexApi.autoAssignGuests, {
      eventId,
      requesterId: session.userId,
      ...(opts?.mode ? { mode: opts.mode } : {}),
      ...(opts?.settings ? { settings: opts.settings } : {}),
    });
    const plan = (await convex.query(convexApi.getSeatingPlan, {
      eventId,
      requesterId: session.userId,
    })) as SeatingPlan;
    return {
      ok: true,
      assigned: res.assigned,
      tablesCreated: res.tablesCreated,
      unplaced: res.unplaced,
      plan,
    };
  } catch (err) {
    return mapError(err);
  }
}

export async function deleteTableAction(tableId: string): Promise<SeatingActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.deleteTable, { tableId, requesterId: session.userId });
    return { ok: true };
  } catch (err) {
    return mapError(err);
  }
}

export async function assignSeatAction(
  eventId: string,
  guestId: string,
  memberIndex: number,
  tableId: string | null,
): Promise<SeatingActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.assignSeat, {
      eventId,
      guestId,
      memberIndex,
      tableId,
      requesterId: session.userId,
    });
    return { ok: true };
  } catch (err) {
    return mapError(err);
  }
}

/**
 * Attribue (ou retire, `seatNumber: null`) le numéro de chaise d'une personne.
 *
 * Renvoie le plan rafraîchi : poser quelqu'un sur une chaise occupée échange
 * les deux personnes côté Convex, donc l'état local du board ne peut pas être
 * dérivé du seul appel — on repart de la vérité serveur.
 */
export async function setSeatNumberAction(
  eventId: string,
  guestId: string,
  memberIndex: number,
  tableId: string,
  seatNumber: number | null,
): Promise<{ ok: true; plan: SeatingPlan } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.assignSeat, {
      eventId,
      guestId,
      memberIndex,
      tableId,
      seatNumber,
      requesterId: session.userId,
    });
    return { ok: true, plan: await fetchPlan(eventId, session.userId) };
  } catch (err) {
    return mapError(err);
  }
}

/**
 * Numérote les chaises. `mode: 'fill'` comble les trous sans écraser les
 * numéros posés à la main ; `'renumber'` repart de 1.
 */
export async function autoNumberSeatsAction(
  eventId: string,
  mode?: 'fill' | 'renumber',
): Promise<{ ok: true; numbered: number; plan: SeatingPlan } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    const res = await convex.mutation(convexApi.autoNumberSeats, {
      eventId,
      requesterId: session.userId,
      ...(mode ? { mode } : {}),
    });
    return { ok: true, numbered: res.numbered, plan: await fetchPlan(eventId, session.userId) };
  } catch (err) {
    return mapError(err);
  }
}

/**
 * Publie / dépublie le plan pour les invités et enregistre les réglages
 * d'affichage. C'est la **validation** exigée avant tout envoi : tant qu'elle
 * n'est pas faite, `getSeatPassByToken` ne rend rien.
 */
export async function setSeatingPublicationAction(
  eventId: string,
  input: {
    published: boolean;
    numbering?: 'table' | 'seat';
    showRoomPlan?: boolean;
    note?: string;
  },
): Promise<{ ok: true; plan: SeatingPlan } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.setSeatingPublication, {
      eventId,
      requesterId: session.userId,
      published: input.published,
      ...(input.numbering ? { numbering: input.numbering } : {}),
      ...(input.showRoomPlan !== undefined ? { showRoomPlan: input.showRoomPlan } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    return { ok: true, plan: await fetchPlan(eventId, session.userId) };
  } catch (err) {
    return mapError(err);
  }
}

/**
 * Envoie les pass placement aux invités concernés, sur le canal de leur
 * invitation. Idempotent côté Convex : seuls les invités jamais prévenus (ou
 * déplacés depuis) sont ciblés, sauf `force`.
 */
export async function broadcastSeatPassesAction(
  eventId: string,
  force?: boolean,
): Promise<
  | { ok: true; sent: number; failed: number; skipped: number; total: number; plan: SeatingPlan }
  | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    const res = await convex.action(convexApi.broadcastSeatPasses, {
      eventId,
      requesterId: session.userId,
      ...(force ? { force: true } : {}),
    });
    return {
      ok: true,
      sent: res.sent,
      failed: res.failed,
      skipped: res.skipped,
      total: res.total,
      plan: await fetchPlan(eventId, session.userId),
    };
  } catch (err) {
    return mapError(err);
  }
}

async function fetchPlan(eventId: string, requesterId: string): Promise<SeatingPlan> {
  const convex = getConvexServerClient();
  return (await convex.query(convexApi.getSeatingPlan, { eventId, requesterId })) as SeatingPlan;
}
