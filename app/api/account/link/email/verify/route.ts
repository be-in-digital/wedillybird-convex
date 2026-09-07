import { NextResponse } from 'next/server';
import { z } from 'zod';
import { emailSchema, otpCodeSchema } from '@/lib/validators/auth';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { getActiveSession } from '@/lib/auth/session';
import { assertSameOrigin } from '@/lib/auth/csrf';

const bodySchema = z.object({ email: emailSchema, code: otpCodeSchema });

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const json = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json) {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_INPUT', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    await getConvexServerClient().mutation(convexApi.verifyLinkEmail, {
      userId: session.userId,
      email: parsed.data.email,
      code: parsed.data.code,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    const code = mapErrorCode(message);
    return NextResponse.json(
      { ok: false, error: code },
      { status: code === 'UNKNOWN' ? 500 : 400 },
    );
  }
}

function mapErrorCode(message: string): string {
  if (message.includes('EMAIL_TAKEN')) return 'EMAIL_TAKEN';
  if (message.includes('NO_ACTIVE_LINK')) return 'NO_ACTIVE_LINK';
  if (message.includes('LINK_EXPIRED')) return 'LINK_EXPIRED';
  if (message.includes('TOO_MANY_ATTEMPTS')) return 'TOO_MANY_ATTEMPTS';
  if (message.includes('INVALID_CODE')) return 'INVALID_CODE';
  if (message.includes('INVALID_EMAIL')) return 'INVALID_EMAIL';
  return 'UNKNOWN';
}
