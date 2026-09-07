import { describe, expect, it, vi, beforeEach } from 'vitest';

const getSessionMock = vi.fn();
const queryMock = vi.fn();

vi.mock('@/lib/auth/session', () => ({
  // La route lit `getActiveSession` : décoder le cookie ne suffit pas, la
  // session d'un compte suspendu doit être refusée.
  getActiveSession: () => getSessionMock(),
}));

vi.mock('@/lib/auth/convex-server', () => ({
  getConvexServerClient: () => ({ query: queryMock }),
  convexApi: {
    getPaymentForInvoice: 'paymentsInvoice:getForInvoice',
  },
}));

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'fr',
}));

import { GET } from '@/app/api/payments/[paymentId]/invoice.pdf/route';

const params = (paymentId: string) => Promise.resolve({ paymentId });

beforeEach(() => {
  getSessionMock.mockReset();
  queryMock.mockReset();
});

const fixturePayment = {
  payment: {
    _id: 'pay_abc12345',
    userId: 'usr_buyer',
    eventId: 'evt_1',
    plan: 'essential' as const,
    currency: 'EUR' as const,
    amountMinor: 1900,
    provider: 'stripe' as const,
    status: 'succeeded' as const,
    createdAt: new Date('2026-04-25T10:00:00Z').getTime(),
    updatedAt: new Date('2026-04-25T10:05:00Z').getTime(),
  },
  event: { _id: 'evt_1', title: 'Mariage de Fatou & Amadou' },
  customer: {
    fullName: 'Fatou Diop',
    email: 'fatou@example.com',
    phone: '+33600000000',
  },
};

describe('GET /api/payments/[paymentId]/invoice.pdf', () => {
  it('returns 401 when no session is present', async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET(new Request('https://test/'), {
      params: params('pay_abc12345'),
    });
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the requester is neither buyer nor owner', async () => {
    getSessionMock.mockResolvedValue({ userId: 'usr_intruder', issuedAt: 0 });
    queryMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await GET(new Request('https://test/'), {
      params: params('pay_abc12345'),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 when the payment is not found', async () => {
    getSessionMock.mockResolvedValue({ userId: 'usr_buyer', issuedAt: 0 });
    queryMock.mockRejectedValue(new Error('PAYMENT_NOT_FOUND'));
    const res = await GET(new Request('https://test/'), {
      params: params('pay_unknown'),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the payment is not yet succeeded', async () => {
    getSessionMock.mockResolvedValue({ userId: 'usr_buyer', issuedAt: 0 });
    queryMock.mockRejectedValue(new Error('PAYMENT_NOT_PAID'));
    const res = await GET(new Request('https://test/'), {
      params: params('pay_pending'),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 with application/pdf for a valid succeeded payment', async () => {
    getSessionMock.mockResolvedValue({ userId: 'usr_buyer', issuedAt: 0 });
    queryMock.mockResolvedValue(fixturePayment);

    const res = await GET(new Request('https://test/'), {
      params: params('pay_abc12345'),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const disposition = res.headers.get('Content-Disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('facture-wedillybird-WB-2026-ABC12345.pdf');

    // Body should contain a non-empty PDF buffer.
    const buffer = new Uint8Array(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    // PDF magic bytes "%PDF" → 0x25 0x50 0x44 0x46
    expect(buffer[0]).toBe(0x25);
    expect(buffer[1]).toBe(0x50);
    expect(buffer[2]).toBe(0x44);
    expect(buffer[3]).toBe(0x46);
  }, 30000);
});
