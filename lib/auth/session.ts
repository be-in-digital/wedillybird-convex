import 'server-only';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'wdb_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
/**
 * Durée de vie absolue d'une session, vérifiée CÔTÉ SERVEUR dans `decodeSession`
 * (le `maxAge` du cookie n'est qu'un indice client, ignorable par un token
 * rejoué). Aligné sur le maxAge du cookie : c'est donc un no-op pour les
 * sessions actuellement valides, mais borne la durée de vie d'un token exfiltré.
 */
const SESSION_MAX_AGE_MS = COOKIE_MAX_AGE * 1000;

export interface SessionPayload {
  userId: string;
  /** Téléphone E.164. Présent pour les sessions OTP WhatsApp. */
  phone?: string;
  /** Email. Présent pour les sessions Magic Link. Au moins un de phone/email. */
  email?: string;
  issuedAt: number;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set and >= 32 chars');
  }
  return secret;
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function encodeSession(payload: SessionPayload): Promise<string> {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

export async function decodeSession(token: string): Promise<SessionPayload | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = await hmac(body);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const padded = body.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(padded);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const payload = JSON.parse(json) as SessionPayload;
    // Expiration côté serveur : refuse un token sans `issuedAt` valide ou dont
    // l'âge dépasse la fenêtre. Défense en profondeur contre le rejeu d'un token
    // exfiltré après la disparition du cookie (le maxAge cookie ne protège pas
    // un token présenté directement). La révocation active (suspend / rotation
    // de rôle / sign-out global) nécessitera en plus un store de sessions.
    if (
      typeof payload.issuedAt !== 'number' ||
      !Number.isFinite(payload.issuedAt) ||
      Date.now() - payload.issuedAt > SESSION_MAX_AGE_MS
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await encodeSession(payload);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return decodeSession(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new Error('UNAUTHENTICATED');
  return session;
}

/**
 * Session **utilisable** : le cookie est valide ET le compte n'est pas
 * suspendu.
 *
 * `getSession` ne décode qu'un cookie : il ne peut rien savoir d'une décision
 * prise après son émission. Sans ce second contrôle, suspendre quelqu'un ne
 * coupait rien tant que son cookie vivait — il gardait l'accès aux pages comme
 * aux routes API. C'est le palliatif au store de sessions absent : une requête
 * Convex par appel, là où l'accès est réellement accordé.
 *
 * Renvoie `null` dans les deux cas, pour que les appelants gardent leur unique
 * branche « pas de session » sans distinguer les motifs.
 */
export async function getActiveSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;

  try {
    const { convexApi, getConvexServerClient } = await import('@/lib/auth/convex-server');
    const user = await getConvexServerClient().query(convexApi.currentUser, {
      userId: session.userId,
    });
    // Compte introuvable (supprimé) ou suspendu → plus de session.
    if (!user || user.suspendedAt != null) return null;
  } catch {
    // Convex injoignable : on ne verrouille pas tout le monde dehors sur une
    // panne réseau. Le refus à la connexion, lui, reste inconditionnel.
    return session;
  }

  return session;
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
