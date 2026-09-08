// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';

// `lib/auth/session.ts` importe `server-only` (qui throw hors RSC) et
// `next/headers`. On les neutralise pour tester la logique pure d'encodage /
// décodage (HMAC + expiration serveur), sans dépendre du runtime Next.
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-session-key-at-least-32-chars';
});

describe('decodeSession — expiration & intégrité côté serveur', () => {
  it('accepte un token fraîchement émis', async () => {
    const { encodeSession, decodeSession } = await import('@/lib/auth/session');
    const token = await encodeSession({
      userId: 'usr_1',
      phone: '+33600000000',
      issuedAt: Date.now(),
    });
    const decoded = await decodeSession(token);
    expect(decoded?.userId).toBe('usr_1');
  });

  it('rejette un token dont issuedAt dépasse la fenêtre de 30 jours', async () => {
    const { encodeSession, decodeSession } = await import('@/lib/auth/session');
    const token = await encodeSession({
      userId: 'usr_1',
      issuedAt: Date.now() - THIRTY_DAYS_MS - 60_000,
    });
    expect(await decodeSession(token)).toBeNull();
  });

  it('rejette un token sans issuedAt valide', async () => {
    const { encodeSession, decodeSession } = await import('@/lib/auth/session');
    // @ts-expect-error — on force un payload sans issuedAt (token legacy/forgé)
    const token = await encodeSession({ userId: 'usr_1' });
    expect(await decodeSession(token)).toBeNull();
  });

  it('rejette un token à signature altérée (tamper)', async () => {
    const { encodeSession, decodeSession } = await import('@/lib/auth/session');
    const token = await encodeSession({ userId: 'usr_1', issuedAt: Date.now() });
    const tampered = token.endsWith('A') ? `${token.slice(0, -1)}B` : `${token.slice(0, -1)}A`;
    expect(await decodeSession(tampered)).toBeNull();
  });
});

/**
 * Le drapeau `Secure` du cookie de session.
 *
 * Il ne tombe QUE sur la pile E2E — `E2E_MODE=1` **et** une URL applicative en
 * clair. Ce test existe parce que la version d'avant, `NODE_ENV === 'production'`
 * seul, rendait tous les parcours authentifiés injouables sous WebKit (qui
 * refuse un cookie `Secure` sur `http://localhost`, là où Chromium l'accepte) —
 * et parce que l'erreur inverse, un cookie de session en clair en production,
 * ne se verrait sur aucun écran.
 */
describe('setSessionCookie — drapeau Secure', () => {
  async function secureFlagFor(env: Record<string, string | undefined>): Promise<boolean> {
    const set = vi.fn();
    const { cookies } = await import('next/headers');
    vi.mocked(cookies).mockResolvedValue({ set } as never);

    // Restauration clé par clé : remplacer `process.env` en bloc laisserait un
    // objet ordinaire à la place de l'environnement du process.
    const previous = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      const { setSessionCookie } = await import('@/lib/auth/session');
      await setSessionCookie({ userId: 'usr_1', issuedAt: Date.now() });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    return (set.mock.calls[0]?.[2] as { secure: boolean }).secure;
  }

  it('pose Secure en production', async () => {
    expect(
      await secureFlagFor({
        NODE_ENV: 'production',
        E2E_MODE: undefined,
        APP_BASE_URL: 'https://wedillybird.com',
      }),
    ).toBe(true);
  });

  it('ne pose pas Secure hors production', async () => {
    expect(await secureFlagFor({ NODE_ENV: 'development', E2E_MODE: undefined })).toBe(false);
  });

  it('retire Secure sur la pile E2E servie en clair', async () => {
    expect(
      await secureFlagFor({
        NODE_ENV: 'production',
        E2E_MODE: '1',
        APP_BASE_URL: 'http://localhost:3000',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      }),
    ).toBe(false);
  });

  it('garde Secure si E2E_MODE traîne sur un déploiement HTTPS', async () => {
    expect(
      await secureFlagFor({
        NODE_ENV: 'production',
        E2E_MODE: '1',
        APP_BASE_URL: 'https://staging.wedillybird.com',
        NEXT_PUBLIC_APP_URL: 'https://staging.wedillybird.com',
      }),
    ).toBe(true);
  });

  it('garde Secure quand aucune URL applicative n’est renseignée', async () => {
    expect(
      await secureFlagFor({
        NODE_ENV: 'production',
        E2E_MODE: '1',
        APP_BASE_URL: undefined,
        NEXT_PUBLIC_APP_URL: undefined,
      }),
    ).toBe(true);
  });
});
