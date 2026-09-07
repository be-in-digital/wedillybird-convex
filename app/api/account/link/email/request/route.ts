import { NextResponse } from 'next/server';
import { z } from 'zod';
import { emailSchema } from '@/lib/validators/auth';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { getActiveSession } from '@/lib/auth/session';
import { assertSameOrigin } from '@/lib/auth/csrf';

const bodySchema = z.object({ email: emailSchema });

function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim();
  return request.headers.get('x-real-ip') ?? undefined;
}

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
    const ip = clientIp(request);
    await getConvexServerClient().action(convexApi.requestLinkEmail, {
      userId: session.userId,
      email: parsed.data.email,
      ...(ip ? { ipAddress: ip } : {}),
    });
    return NextResponse.json({ ok: true, email: parsed.data.email });
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
  if (message.includes('ALREADY_LINKED')) return 'ALREADY_LINKED';
  if (message.includes('RATE_LIMITED')) return 'RATE_LIMITED';
  if (message.includes('INVALID_EMAIL')) return 'INVALID_EMAIL';
  return 'UNKNOWN';
}
