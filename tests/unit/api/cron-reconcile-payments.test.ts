import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '@/lib/analytics/events';

/**
 * Cron de réconciliation Stripe↔Convex (T2-2). Le point critique testé ici :
 * ce cron ne doit JAMAIS forger un marquage — il re-vérifie toujours Stripe
 * (`retrieveSessionStatus`) et n'appelle que la MÊME mutation gardée que le
 * webhook (`markPaymentSucceeded`). Un paiement que Stripe dit "pas payé"
 * reste `pending` : on alerte, on ne force jamais `markFailed`.
 */

const queryMock = vi.fn();
const mutationMock = vi.fn();
const captureServerMock = vi.fn();
const retrieveSessionStatusMock = vi.fn();

vi.mock('@/lib/auth/convex-server', () => ({
  getConvexServerClient: () => ({ query: queryMock, mutation: mutationMock }),
  convexApi: {
    listStalePendingPayments: 'payments:listStalePending',
    markPaymentSucceeded: 'payments:markSucceeded',
  },
}));

vi.mock('@/lib/payments', () => ({
  getPaymentDriver: () => ({ retrieveSessionStatus: retrieveSessionStatusMock }),
}));

// PAS d'`importOriginal()` ici : `posthog-server.ts` importe le marker
// `server-only`, dont la résolution échoue sous l'environnement de test
// jsdom. On remplace intégralement le module ; `EVENTS` vient du module SANS
// `server-only` (`lib/analytics/events.ts`, pur) pour ne pas dupliquer les
// noms d'events à la main (risque de dérive).
vi.mock('@/lib/analytics/posthog-server', () => ({
  captureServer: captureServerMock,
  EVENTS,
}));

afterEach(() => {
  queryMock.mockReset();
  mutationMock.mockReset();
  captureServerMock.mockReset();
  retrieveSessionStatusMock.mockReset();
  vi.unstubAllEnvs();
  delete process.env.CRON_SECRET;
  delete process.env.CONVEX_WEBHOOK_SECRET;
});

function makeRequest(bearerSecret?: string): Request {
  return new Request('http://localhost/api/cron/reconcile-payments', {
    headers: bearerSecret ? { authorization: `Bearer ${bearerSecret}` } : {},
  });
}

describe('GET /api/cron/reconcile-payments', () => {
  it('401 sans CRON_SECRET valide dans le header Authorization', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    const { GET } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await GET(makeRequest('wrong-secret'));
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("401 si CRON_SECRET n'est pas configurée côté serveur — pas de fallback silencieux", async () => {
    const { GET } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await GET(makeRequest('anything'));
    expect(res.status).toBe(401);
  });

  it('500 si CONVEX_WEBHOOK_SECRET est absente côté serveur', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    const { GET } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await GET(makeRequest('right-secret'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'WEBHOOK_SECRET_NOT_CONFIGURED' });
  });

  it('récupère un paiement confirmé payé par Stripe via la MÊME mutation gardée que le webhook', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    vi.stubEnv('CONVEX_WEBHOOK_SECRET', 'webhook-secret');
    queryMock.mockResolvedValue([
      {
        _id: 'pay_1',
        provider: 'stripe',
        providerSessionId: 'sess_1',
        userId: 'user_1',
        eventId: 'event_1',
        plan: 'essential',
        currency: 'EUR',
        amountMinor: 2900,
        createdAt: Date.now() - 40 * 60 * 1000,
      },
    ]);
    retrieveSessionStatusMock.mockResolvedValue({
      paid: true,
      providerSessionId: 'sess_1',
      providerEventId: 'sess_1',
      amountMinor: 2900,
      currency: 'EUR',
    });
    mutationMock.mockResolvedValue({ ok: true, alreadyApplied: false });

    const { GET } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await GET(makeRequest('right-secret'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, scanned: 1, recovered: 1, stillPending: 0, errors: 0 });

    expect(queryMock).toHaveBeenCalledWith(
      'payments:listStalePending',
      expect.objectContaining({ webhookSecret: 'webhook-secret', olderThanMs: 30 * 60 * 1000 }),
    );
    expect(mutationMock).toHaveBeenCalledWith('payments:markSucceeded', {
      webhookSecret: 'webhook-secret',
      provider: 'stripe',
      providerSessionId: 'sess_1',
      providerEventId: 'sess_1',
      // Mêmes bases d'affiliation que le webhook : encaissement RÉEL relu chez
      // Stripe, assiette hors taxes (2900 TTC → 2417 HT en EUR) et code promo
      // tapé au checkout, pour que ce cron attribue et calcule exactement comme
      // le webhook s'il gagne la course.
      netMinor: 2900,
      commissionBaseMinor: 2417,
      promotionCode: undefined,
    });
    // Analytics revenu émis pour le paiement récupéré, comme le webhook.
    expect(captureServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'purchase_completed', distinctId: 'user_1' }),
    );
  });

  it('ne recompte pas en revenu un paiement déjà appliqué (idempotence alreadyApplied)', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    vi.stubEnv('CONVEX_WEBHOOK_SECRET', 'webhook-secret');
    queryMock.mockResolvedValue([
      {
        _id: 'pay_race',
        provider: 'stripe',
        providerSessionId: 'sess_race',
        userId: 'user_1',
        eventId: 'event_1',
        plan: 'essential',
        currency: 'EUR',
        amountMinor: 2900,
        createdAt: Date.now() - 40 * 60 * 1000,
      },
    ]);
    retrieveSessionStatusMock.mockResolvedValue({
      paid: true,
      providerSessionId: 'sess_race',
      providerEventId: 'sess_race',
      amountMinor: 2900,
      currency: 'EUR',
    });
    // Le webhook a gagné la course juste avant le cron.
    mutationMock.mockResolvedValue({ ok: true, alreadyApplied: true });

    const { GET } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await GET(makeRequest('right-secret'));
    const body = await res.json();
    expect(body).toEqual({ ok: true, scanned: 1, recovered: 0, stillPending: 0, errors: 0 });
    expect(captureServerMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'purchase_completed' }),
    );
  });

  it("NE force JAMAIS markFailed : un paiement toujours pending selon Stripe reste inchangé, et déclenche l'alerte", async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    vi.stubEnv('CONVEX_WEBHOOK_SECRET', 'webhook-secret');
    queryMock.mockResolvedValue([
      {
        _id: 'pay_2',
        provider: 'stripe',
        providerSessionId: 'sess_2',
        userId: 'user_2',
        eventId: 'event_2',
        plan: 'premium',
        currency: 'EUR',
        amountMinor: 5900,
        createdAt: Date.now() - 45 * 60 * 1000,
      },
    ]);
    retrieveSessionStatusMock.mockResolvedValue({
      paid: false,
      providerSessionId: 'sess_2',
      providerEventId: 'sess_2',
      amountMinor: 5900,
      currency: 'EUR',
    });

    const { GET } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await GET(makeRequest('right-secret'));
    const body = await res.json();
    expect(body).toEqual({ ok: true, scanned: 1, recovered: 0, stillPending: 1, errors: 0 });

    // Aucune mutation appelée du tout — surtout pas un markFailed forgé.
    expect(mutationMock).not.toHaveBeenCalled();
    expect(captureServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment_reconciliation_stuck',
        properties: expect.objectContaining({ payment_id: 'pay_2', event_id: 'event_2' }),
      }),
    );
  });

  it('isole les paiements en erreur : un retrieveSessionStatus qui jette est compté et alerté sans bloquer les autres', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    vi.stubEnv('CONVEX_WEBHOOK_SECRET', 'webhook-secret');
    queryMock.mockResolvedValue([
      {
        _id: 'pay_err',
        provider: 'stripe',
        providerSessionId: 'sess_err',
        userId: 'user_err',
        eventId: 'event_err',
        plan: 'essential',
        currency: 'EUR',
        amountMinor: 2900,
        createdAt: Date.now() - 40 * 60 * 1000,
      },
      {
        _id: 'pay_ok',
        provider: 'stripe',
        providerSessionId: 'sess_ok',
        userId: 'user_ok',
        eventId: 'event_ok',
        plan: 'essential',
        currency: 'EUR',
        amountMinor: 2900,
        createdAt: Date.now() - 40 * 60 * 1000,
      },
    ]);
    retrieveSessionStatusMock
      .mockRejectedValueOnce(new Error('STRIPE_UNAVAILABLE'))
      .mockResolvedValueOnce({
        paid: true,
        providerSessionId: 'sess_ok',
        providerEventId: 'sess_ok',
        amountMinor: 2900,
        currency: 'EUR',
      });
    mutationMock.mockResolvedValue({ ok: true, alreadyApplied: false });

    const { GET } = await import('@/app/api/cron/reconcile-payments/route');
    const res = await GET(makeRequest('right-secret'));
    const body = await res.json();
    expect(body).toEqual({ ok: true, scanned: 2, recovered: 1, stillPending: 0, errors: 1 });
    expect(captureServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'webhook_processing_failed',
        properties: expect.objectContaining({ payment_id: 'pay_err' }),
      }),
    );
  });
});
