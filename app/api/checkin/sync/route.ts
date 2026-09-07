import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getActiveSession } from '@/lib/auth/session';
import { assertSameOrigin } from '@/lib/auth/csrf';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';

/**
 * POST /api/checkin/sync — drain de la queue Dexie de check-ins offline.
 *
 * Authentifié via la même session que la page check-in (cookie wdb_session).
 * Chaque entrée est appliquée idempotamment : si l'invité est déjà checked-in,
 * la mutation Convex retourne `alreadyCheckedIn: true` sans throw, ce qui
 * permet de re-jouer une queue plusieurs fois sans dégât.
 *
 * Le `scannedAt` côté client est ignoré pour l'instant (la mutation actuelle
 * utilise `Date.now()` côté Convex). Une évolution future pourrait patcher
 * `checkedInAt` avec le timestamp réel du scan plutôt que celui de la sync —
 * cf. BACKLOG si besoin de précision sur les statistiques d'arrivée.
 */

const bodySchema = z.object({
  eventId: z.string().min(1),
  checkIns: z
    .array(
      z.object({
        token: z.string().min(1).max(256),
        scannedAt: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'INVALID_INPUT',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const convex = getConvexServerClient();
  const { eventId, checkIns } = parsed.data;

  const results: Array<{
    token: string;
    ok: boolean;
    alreadyCheckedIn?: boolean;
    error?: string;
  }> = [];

  // Sérialisé : la mutation Convex est très rapide et on évite les rate-limits
  // côté Convex / un thundering herd si l'utilisateur a 200 check-ins en
  // attente. La queue est bornée à 500 par requête.
  for (const item of checkIns) {
    try {
      const result = await convex.mutation(convexApi.checkInByToken, {
        token: item.token,
        eventId,
        requesterId: session.userId,
      });
      results.push({
        token: item.token,
        ok: true,
        alreadyCheckedIn: result.alreadyCheckedIn,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UNKNOWN';
      results.push({ token: item.token, ok: false, error: message });
    }
  }

  return NextResponse.json({
    ok: true,
    syncedAt: Date.now(),
    total: checkIns.length,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
