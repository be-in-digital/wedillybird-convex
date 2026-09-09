'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';

export type CheckInResult =
  | {
      ok: true;
      alreadyCheckedIn: boolean;
      checkedInAt: number;
      guest: {
        _id: string;
        fullName: string;
        category?: string;
        plusOnesAllowed: number;
        rsvpStatus: 'pending' | 'attending' | 'declined' | 'maybe';
        /** Placement de l'invité, `null` s'il n'est pas assigné. */
        tableName: string | null;
        seatNumber: number | null;
      };
    }
  | { ok: false; error: 'UNAUTHORIZED' | 'GUEST_NOT_FOUND' | 'GUEST_WRONG_EVENT' | 'UNKNOWN' };

export async function checkInByTokenAction(eventId: string, token: string): Promise<CheckInResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHORIZED' };

  try {
    const convex = getConvexServerClient();
    const result = await convex.mutation(convexApi.checkInByToken, {
      token,
      eventId,
      requesterId: session.userId,
    });
    revalidatePath(`/events/${eventId}/check-in`);
    return {
      ok: true,
      alreadyCheckedIn: result.alreadyCheckedIn,
      checkedInAt: result.checkedInAt,
      guest: result.guest,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    if (message === 'GUEST_NOT_FOUND') return { ok: false, error: 'GUEST_NOT_FOUND' };
    if (message === 'GUEST_WRONG_EVENT') return { ok: false, error: 'GUEST_WRONG_EVENT' };
    if (message === 'FORBIDDEN') return { ok: false, error: 'UNAUTHORIZED' };
    return { ok: false, error: 'UNKNOWN' };
  }
}

export async function undoCheckInAction(
  eventId: string,
  guestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'UNAUTHORIZED' };

  try {
    const convex = getConvexServerClient();
    await convex.mutation(convexApi.undoCheckIn, {
      guestId,
      requesterId: session.userId,
    });
    revalidatePath(`/events/${eventId}/check-in`);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    return { ok: false, error: message };
  }
}
