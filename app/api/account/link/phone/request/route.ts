import { NextResponse } from 'next/server';
import { z } from 'zod';
import { phoneSchema } from '@/lib/validators/auth';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { getActiveSession } from '@/lib/auth/session';
import { assertSameOrigin } from '@/lib/auth/csrf';

const bodySchema = z.object({ phone: phoneSchema });

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
    await getConvexServerClient().action(convexApi.requestLinkPhone, {
      userId: session.userId,
      phone: parsed.data.phone,
      ...(ip ? { ipAddress: ip } : {}),
    });
    return NextResponse.json({ ok: true, phone: parsed.data.phone });
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
  // Le plus spécifique d'abord : `WHATSAPP_UNDELIVERABLE` est un refus
  // DÉFINITIF du destinataire (numéro hors liste autorisée d'un WABA non
  // vérifié, ou pas de compte WhatsApp actif), pas un incident passager.
  // Sans ce cas il retombait en `UNKNOWN`, et l'onboarding affichait
  // « une erreur est survenue » — la personne réessayait indéfiniment un
  // numéro qui ne recevra jamais rien.
  if (message.includes('WHATSAPP_UNDELIVERABLE')) return 'UNDELIVERABLE';
  if (message.includes('PHONE_TAKEN')) return 'PHONE_TAKEN';
  if (message.includes('ALREADY_LINKED')) return 'ALREADY_LINKED';
  if (message.includes('RATE_LIMITED')) return 'RATE_LIMITED';
  if (message.includes('INVALID_PHONE')) return 'INVALID_PHONE';
  if (message.includes('WHATSAPP_SEND_FAILED')) return 'SEND_FAILED';
  return 'UNKNOWN';
}
