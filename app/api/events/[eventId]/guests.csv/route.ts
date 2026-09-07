import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { normalizeRsvpConfig } from '@/lib/rsvp/questions';

/** Colonnes fixes ; les questions custom sont ajoutées dynamiquement ensuite. */
const BASE_HEADERS = [
  'fullName',
  'phone',
  'email',
  'category',
  'plusOnesAllowed',
  'plusOnesNames',
  'rsvpStatus',
  'dietaryRestrictions',
];
const TRAILING_HEADERS = ['notes', 'qrCodeToken'];

function escapeField(value: string | number | undefined): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { eventId } = await ctx.params;
  const convex = getConvexServerClient();

  try {
    const [guests, event] = await Promise.all([
      convex.query(convexApi.listGuestsByEvent, { eventId, requesterId: session.userId }),
      convex.query(convexApi.getEventById, { eventId, requesterId: session.userId }),
    ]);

    // Une colonne par question custom (dans l'ordre de la config), libellée par
    // son intitulé — les réponses sont jointes par « | ».
    const questions = normalizeRsvpConfig(event?.rsvpConfig).customQuestions;
    const headers = [...BASE_HEADERS, ...questions.map((q) => q.label), ...TRAILING_HEADERS];

    const lines: string[] = [headers.map(escapeField).join(',')];
    for (const g of guests) {
      const answerByQuestion = new Map(
        (g.customAnswers ?? []).map((a) => [a.questionId, a.values.join(' | ')]),
      );
      lines.push(
        [
          escapeField(g.fullName),
          escapeField(g.phone),
          escapeField(g.email),
          escapeField(g.category),
          escapeField(g.plusOnesAllowed),
          escapeField((g.plusOnesNames ?? []).join(' | ')),
          escapeField(g.rsvpStatus),
          escapeField(g.dietaryRestrictions),
          ...questions.map((q) => escapeField(answerByQuestion.get(q.id) ?? '')),
          escapeField(g.notes),
          escapeField(g.qrCodeToken),
        ].join(','),
      );
    }

    const csv = lines.join('\n') + '\n';
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="guests-${eventId}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    if (message === 'EVENT_NOT_FOUND') {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ error: 'UNKNOWN' }, { status: 500 });
  }
}
