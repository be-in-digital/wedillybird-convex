'use server';

import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import type {
  CouplePaymentKind,
  CoupleRoomFloor,
  CoupleTableShape,
  CoupleTaskStatus,
  CoupleVendorStatus,
} from '@/convex/lib/coupleModel';
import type { MmAttachment, MmRoomElement } from '@/lib/mon-mariage/types';

/**
 * Server actions de l'espace couple self-serve « /mon-mariage ». Mêmes
 * conventions que le seating agence : session → UNAUTHENTICATED, erreurs
 * Convex mappées sur des codes connus, résultat `{ ok }`. Les écrans font de
 * l'optimiste (état local mis à jour immédiatement, revert sur `ok: false`).
 */

export type MmActionResult = { ok: true; id?: string } | { ok: false; error: string };

const KNOWN_ERRORS = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'EVENT_NOT_FOUND',
  'FEATURE_LOCKED',
  'VENDOR_NOT_FOUND',
  'VENDOR_MISMATCH',
  'PAYMENT_NOT_FOUND',
  'PAID_EXCEEDS_AMOUNT',
  'PHASE_NOT_FOUND',
  'TASK_NOT_FOUND',
  'TABLE_NOT_FOUND',
  'TOO_MANY_TABLES',
  'TOO_MANY_ELEMENTS',
  'INVALID_ROOM_SIZE',
  'INVALID_CAPACITY',
  'INVALID_CATEGORY',
  'INVALID_STATUS',
  'INVALID_LABEL',
  'INVITATION_LIMIT_REACHED',
  'FEATURE_NOT_IN_PLAN',
  'SEATING_NOT_PUBLISHED',
  'EVENT_NOT_FOUND_OR_FORBIDDEN',
  'INVALID_CINEMATIC',
  'INVALID_MUSIC_TRACK',
  'INVALID_MUSIC_KEY',
  'INVALID_CONTENT_TYPE',
] as const;

function mapError(err: unknown): { ok: false; error: string } {
  const message = err instanceof Error ? err.message : 'UNKNOWN';
  const hit = KNOWN_ERRORS.find((code) => message.includes(code));
  return { ok: false, error: hit ?? 'UNKNOWN' };
}

async function run<T extends { ok: boolean }>(fn: (userId: string) => Promise<T>) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: 'UNAUTHENTICATED' };
  try {
    return await fn(session.userId);
  } catch (err) {
    return mapError(err);
  }
}

/* ============================ Bundle (refetch client) ============================ */

export async function mmRefreshBundleAction(): Promise<
  | { ok: true; bundle: import('@/lib/mon-mariage/types').MmBundle | null }
  | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    const bundle = await convex.query(convexApi.coupleSpaceBundle, {
      requesterId: session.userId,
    });
    return { ok: true, bundle };
  } catch (err) {
    return mapError(err);
  }
}

/* ============================ Invités (dashboard) ============================ */

export async function mmAddGuestAction(
  eventId: string,
  input: { fullName: string; phone?: string; category?: string; plusOnesAllowed: number },
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    const res = await convex.mutation(convexApi.addGuest, {
      eventId,
      requesterId: userId,
      fullName: input.fullName,
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.category ? { category: input.category } : {}),
      plusOnesAllowed: input.plusOnesAllowed,
    });
    return { ok: true as const, id: res.id };
  });
}

/* ============================ Prestataires ============================ */

export interface MmVendorInput {
  name: string;
  category: string;
  status: CoupleVendorStatus;
  amountMinor: number;
  paidMinor: number;
  contact?: string;
  email?: string;
  note?: string;
  attachments?: MmAttachment[];
}

export async function mmAddVendorAction(
  eventId: string,
  input: MmVendorInput,
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    const id = await convex.mutation(convexApi.coupleAddVendor, {
      eventId,
      requesterId: userId,
      ...input,
    });
    return { ok: true as const, id };
  });
}

export async function mmUpdateVendorAction(
  vendorId: string,
  input: Partial<MmVendorInput>,
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleUpdateVendor, {
      vendorId,
      requesterId: userId,
      ...input,
    });
    return { ok: true as const };
  });
}

export async function mmRemoveVendorAction(vendorId: string): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleRemoveVendor, { vendorId, requesterId: userId });
    return { ok: true as const };
  });
}

/* ============================ Échéancier & budget ============================ */

export async function mmAddPaymentAction(
  eventId: string,
  input: {
    vendorId?: string;
    vendorName: string;
    category: string;
    kind: CouplePaymentKind;
    dueDate: number;
    amountMinor: number;
  },
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    const id = await convex.mutation(convexApi.coupleAddPayment, {
      eventId,
      requesterId: userId,
      ...input,
    });
    return { ok: true as const, id };
  });
}

export async function mmSetPaymentPaidAction(
  paymentId: string,
  input: { paidMinor: number; paidAt?: number; attachments?: MmAttachment[] },
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleSetPaymentPaid, {
      paymentId,
      requesterId: userId,
      ...input,
    });
    return { ok: true as const };
  });
}

export async function mmRemovePaymentAction(paymentId: string): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleRemovePayment, { paymentId, requesterId: userId });
    return { ok: true as const };
  });
}

export async function mmSetBudgetEnvelopeAction(
  eventId: string,
  budgetEnvelopeMinor: number,
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleSetBudgetEnvelope, {
      eventId,
      requesterId: userId,
      budgetEnvelopeMinor,
    });
    return { ok: true as const };
  });
}

/* ============================ Rétroplanning ============================ */

export async function mmEnsurePlanningAction(eventId: string): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleEnsureDefaultPlanning, {
      eventId,
      requesterId: userId,
    });
    return { ok: true as const };
  });
}

export async function mmAddPhaseAction(
  eventId: string,
  input: { label: string; sub?: string },
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    const id = await convex.mutation(convexApi.coupleAddPhase, {
      eventId,
      requesterId: userId,
      ...input,
    });
    return { ok: true as const, id };
  });
}

export async function mmAddTaskAction(
  phaseId: string,
  input: { label: string; dueDate?: number },
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    const id = await convex.mutation(convexApi.coupleAddTask, {
      phaseId,
      requesterId: userId,
      ...input,
    });
    return { ok: true as const, id };
  });
}

export async function mmSetTaskStatusAction(
  taskId: string,
  status: CoupleTaskStatus,
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleSetTaskStatus, {
      taskId,
      requesterId: userId,
      status,
    });
    return { ok: true as const };
  });
}

export async function mmRemoveTaskAction(taskId: string): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleRemoveTask, { taskId, requesterId: userId });
    return { ok: true as const };
  });
}

/* ============================ Plan de table ============================ */

export async function mmSaveRoomAction(
  eventId: string,
  input: {
    name: string;
    widthM: number;
    lengthM: number;
    floor: CoupleRoomFloor;
    elements: MmRoomElement[];
  },
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleSaveRoom, {
      eventId,
      requesterId: userId,
      ...input,
    });
    return { ok: true as const };
  });
}

export async function mmUpsertTableAction(
  eventId: string,
  input: {
    tableId?: string;
    name: string;
    shape: CoupleTableShape;
    capacity: number;
    x: number;
    y: number;
    rotation: number;
    honor?: boolean;
    notes?: string;
  },
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    const id = await convex.mutation(convexApi.coupleUpsertTable, {
      eventId,
      requesterId: userId,
      ...input,
    });
    return { ok: true as const, id };
  });
}

/**
 * Publie / dépublie le plan de table pour les invités (validation explicite du
 * couple) et enregistre ce qu'ils verront. Miroir couple de
 * `setSeatingPublicationAction` côté agence.
 */
export async function mmSetSeatingPublicationAction(
  eventId: string,
  input: {
    published: boolean;
    numbering?: 'table' | 'seat';
    showRoomPlan?: boolean;
    note?: string;
  },
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.setSeatingPublication, {
      eventId,
      requesterId: userId,
      published: input.published,
      ...(input.numbering ? { numbering: input.numbering } : {}),
      ...(input.showRoomPlan !== undefined ? { showRoomPlan: input.showRoomPlan } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    return { ok: true as const };
  });
}

/** Numérote les chaises (`fill` = comble les trous, `renumber` = repart de 1). */
export async function mmAutoNumberSeatsAction(
  eventId: string,
  mode?: 'fill' | 'renumber',
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.autoNumberSeats, {
      eventId,
      requesterId: userId,
      ...(mode ? { mode } : {}),
    });
    return { ok: true as const };
  });
}

/**
 * Envoie les pass placement sur le canal d'invitation de chaque invité.
 * Refusé côté Convex si le plan n'est pas publié.
 */
export async function mmBroadcastSeatPassesAction(
  eventId: string,
  force?: boolean,
): Promise<MmActionResult & { sent?: number; failed?: number; skipped?: number }> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    const res = await convex.action(convexApi.broadcastSeatPasses, {
      eventId,
      requesterId: userId,
      ...(force ? { force: true } : {}),
    });
    return { ok: true as const, sent: res.sent, failed: res.failed, skipped: res.skipped };
  });
}

export async function mmRemoveTableAction(tableId: string): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleRemoveTable, { tableId, requesterId: userId });
    return { ok: true as const };
  });
}

export async function mmAssignGuestTableAction(
  guestId: string,
  tableId: string | null,
): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleAssignGuestTable, {
      guestId,
      requesterId: userId,
      tableId,
    });
    return { ok: true as const };
  });
}

/* ============== Invitation (cinématique + musique + photo) ============== */

export async function mmSetInvitationDesignAction(input: {
  eventId: string;
  cinematic?: string;
  music?: { source: 'library' | 'custom'; trackId?: string; s3Key?: string; title?: string };
  clearMusic?: boolean;
  photo?: { s3Key: string; width?: number; height?: number };
  clearPhoto?: boolean;
}): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleSetInvitationDesign, {
      eventId: input.eventId,
      requesterId: userId,
      cinematic: input.cinematic,
      music: input.music,
      clearMusic: input.clearMusic,
      photo: input.photo,
      clearPhoto: input.clearPhoto,
    });
    return { ok: true as const };
  });
}

/** Déroulé de la journée (planning de cérémonie) affiché sur l'invitation. */
export async function mmSetCeremonyScheduleAction(input: {
  eventId: string;
  schedule: Array<{ time: string; title: string; note?: string }>;
}): Promise<MmActionResult> {
  return run(async (userId) => {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.coupleSetCeremonySchedule, {
      eventId: input.eventId,
      requesterId: userId,
      schedule: input.schedule,
    });
    return { ok: true as const };
  });
}

/** Presigned PUT S3 pour la musique personnalisée (≤ 10 Mo, audio/*). */
export async function mmCreateMusicUploadUrlAction(input: {
  eventId: string;
  contentType: string;
}): Promise<{ ok: true; uploadUrl: string; s3Key: string } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    const res = await convex.action(convexApi.createInvitationMusicUploadUrl, {
      eventId: input.eventId,
      requesterId: session.userId,
      contentType: input.contentType,
    });
    return { ok: true, ...res };
  } catch (err) {
    return mapError(err);
  }
}

/** Presigned PUT S3 pour la photo du couple (JPEG/PNG/WebP, compressée client). */
export async function mmCreateInvitationPhotoUploadUrlAction(input: {
  eventId: string;
  contentType: string;
}): Promise<{ ok: true; uploadUrl: string; s3Key: string } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const convex = getConvexServerClient();
    const res = await convex.action(convexApi.createInvitationPhotoUploadUrl, {
      eventId: input.eventId,
      requesterId: session.userId,
      contentType: input.contentType,
    });
    return { ok: true, ...res };
  } catch (err) {
    return mapError(err);
  }
}
