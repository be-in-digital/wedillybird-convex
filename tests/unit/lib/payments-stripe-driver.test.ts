import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const stripeMock = {
  checkout: {
    sessions: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
  },
  webhooks: {
    constructEvent: vi.fn(),
  },
  promotionCodes: {
    retrieve: vi.fn(),
  },
};

vi.mock('stripe', () => ({
  default: function StripeMock() {
    return stripeMock;
  },
}));

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;
const ORIGINAL_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
  stripeMock.checkout.sessions.create.mockReset();
  stripeMock.checkout.sessions.retrieve.mockReset();
  stripeMock.webhooks.constructEvent.mockReset();
  stripeMock.promotionCodes.retrieve.mockReset();
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
  if (ORIGINAL_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

const checkoutInput = {
  provider: 'stripe' as const,
  plan: 'essential' as const,
  currency: 'EUR' as const,
  amountMinor: 4900,
  eventId: 'evt_1',
  userId: 'usr_1',
  successUrl: 'https://app.test/ok',
  cancelUrl: 'https://app.test/cancel',
};

describe('payments/drivers/stripe — createCheckout', () => {
  it('forwards plan + amount + metadata to Stripe and returns session id + url', async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_xyz',
      url: 'https://checkout.stripe.com/cs_test_xyz',
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.createCheckout(checkoutInput);

    expect(result).toEqual({
      providerSessionId: 'cs_test_xyz',
      redirectUrl: 'https://checkout.stripe.com/cs_test_xyz',
    });
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const args = stripeMock.checkout.sessions.create.mock.calls[0]![0];
    expect(args.mode).toBe('payment');
    expect(args.line_items[0].price_data.currency).toBe('eur');
    expect(args.line_items[0].price_data.unit_amount).toBe(4900);
    expect(args.metadata).toEqual({ eventId: 'evt_1', userId: 'usr_1', plan: 'essential' });
    expect(args.locale).toBe('auto');
    expect(args.success_url).toContain('session_id={CHECKOUT_SESSION_ID}');
    expect(args.custom_text).toBeUndefined();
  });

  it('converts XOF centimes to whole units before passing to Stripe', async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_x',
      url: 'https://checkout.stripe.com/cs_x',
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    await stripeDriver.createCheckout({
      ...checkoutInput,
      currency: 'XOF',
      amountMinor: 3200000, // 32 000 XOF
    });

    const args = stripeMock.checkout.sessions.create.mock.calls[0]![0];
    expect(args.line_items[0].price_data.currency).toBe('xof');
    expect(args.line_items[0].price_data.unit_amount).toBe(32000);
  });

  it('throws when Stripe omits the session url', async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs_only_id' });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    await expect(stripeDriver.createCheckout(checkoutInput)).rejects.toThrow(
      'STRIPE_NO_REDIRECT_URL',
    );
  });

  it('throws NOT_CONFIGURED when STRIPE_SECRET_KEY is missing', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    await expect(stripeDriver.createCheckout(checkoutInput)).rejects.toThrow(
      'STRIPE_DRIVER_NOT_CONFIGURED',
    );
  });
});

describe('payments/drivers/stripe — verifyAndParseWebhook', () => {
  it('returns succeeded for checkout.session.completed', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          currency: 'eur',
          amount_total: 4900,
          payment_status: 'paid',
        },
      },
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.verifyAndParseWebhook('{}', 'sig');
    expect(result).toEqual({
      providerSessionId: 'cs_test_1',
      providerEventId: 'evt_1',
      status: 'succeeded',
      amountMinor: 4900,
      currency: 'EUR',
      failureReason: undefined,
    });
  });

  it('returns failed for async_payment_failed', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'checkout.session.async_payment_failed',
      data: {
        object: {
          id: 'cs_test_2',
          currency: 'eur',
          amount_total: 4900,
          payment_status: 'unpaid',
        },
      },
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.verifyAndParseWebhook('{}', 'sig');
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('unpaid');
  });

  it('multiplies stripe XOF whole units back to internal centimes', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_3',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_3',
          currency: 'xof',
          amount_total: 32000,
          payment_status: 'paid',
        },
      },
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.verifyAndParseWebhook('{}', 'sig');
    expect(result.amountMinor).toBe(3200000);
    expect(result.currency).toBe('XOF');
  });

  it('rejects missing signature', async () => {
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');
    await expect(stripeDriver.verifyAndParseWebhook('{}', null)).rejects.toThrow(
      'INVALID_SIGNATURE',
    );
  });

  it('rejects when constructEvent throws', async () => {
    stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('signature mismatch');
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    await expect(stripeDriver.verifyAndParseWebhook('{}', 'bad')).rejects.toThrow(
      'INVALID_SIGNATURE',
    );
  });

  it('rejects unsupported event types', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_x',
      type: 'invoice.created',
      data: { object: {} },
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    await expect(stripeDriver.verifyAndParseWebhook('{}', 'sig')).rejects.toThrow(
      'UNSUPPORTED_EVENT',
    );
  });
});

describe('payments/drivers/stripe — retrieveSessionStatus', () => {
  it('returns paid:true when Stripe reports payment_status === paid', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_paid',
      currency: 'eur',
      amount_total: 4900,
      payment_status: 'paid',
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.retrieveSessionStatus('cs_test_paid');
    expect(result).toEqual({
      paid: true,
      providerSessionId: 'cs_test_paid',
      providerEventId: 'cs_test_paid',
      amountMinor: 4900,
      currency: 'EUR',
    });
  });

  it('returns paid:false when payment_status is not paid', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_unpaid',
      currency: 'eur',
      amount_total: 4900,
      payment_status: 'unpaid',
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.retrieveSessionStatus('cs_test_unpaid');
    expect(result.paid).toBe(false);
  });

  it('multiplies XOF whole units back to internal centimes', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_xof',
      currency: 'xof',
      amount_total: 32000,
      payment_status: 'paid',
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.retrieveSessionStatus('cs_xof');
    expect(result.amountMinor).toBe(3200000);
    expect(result.currency).toBe('XOF');
  });
});

/**
 * Attribution partenaire quand l'acheteur TAPE le code au checkout au lieu de
 * cliquer le lien `?ref=` : aucun cookie n'est posé, donc le seul indice
 * restant est le code promo porté par la session. Dans un payload de webhook,
 * `discounts[].promotion_code` est un ID (`promo_…`) — il faut le résoudre.
 */
describe('payments/drivers/stripe — code promo remonté pour l’attribution', () => {
  it('résout l’ID de code promo en code lisible', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_promo',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_promo',
          currency: 'eur',
          amount_total: 5310,
          payment_status: 'paid',
          discounts: [{ promotion_code: 'promo_123' }],
        },
      },
    });
    stripeMock.promotionCodes.retrieve.mockResolvedValue({ id: 'promo_123', code: 'SARAH' });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.verifyAndParseWebhook('{}', 'sig');
    expect(stripeMock.promotionCodes.retrieve).toHaveBeenCalledWith('promo_123');
    expect(result.promotionCode).toBe('SARAH');
    // Le net encaissé (après remise) est bien ce qui remonte, pas le catalogue.
    expect(result.amountMinor).toBe(5310);
  });

  it('accepte un code promo déjà développé sans rappeler l’API', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_promo2',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_promo2',
          currency: 'eur',
          amount_total: 5310,
          payment_status: 'paid',
          discounts: [{ promotion_code: { id: 'promo_9', code: 'SARAH' } }],
        },
      },
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.verifyAndParseWebhook('{}', 'sig');
    expect(result.promotionCode).toBe('SARAH');
    expect(stripeMock.promotionCodes.retrieve).not.toHaveBeenCalled();
  });

  it('sans code promo : champ absent, aucun appel API', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_plain',
      type: 'checkout.session.completed',
      data: {
        object: { id: 'cs_plain', currency: 'eur', amount_total: 5900, payment_status: 'paid' },
      },
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.verifyAndParseWebhook('{}', 'sig');
    expect(result.promotionCode).toBeUndefined();
    expect(stripeMock.promotionCodes.retrieve).not.toHaveBeenCalled();
  });

  it('une erreur Stripe ne fait jamais échouer la confirmation du paiement', async () => {
    // Perdre l'attribution est regrettable ; perdre le paiement serait pire.
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_boom',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_boom',
          currency: 'eur',
          amount_total: 5900,
          payment_status: 'paid',
          discounts: [{ promotion_code: 'promo_dead' }],
        },
      },
    });
    stripeMock.promotionCodes.retrieve.mockRejectedValue(new Error('stripe down'));
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const result = await stripeDriver.verifyAndParseWebhook('{}', 'sig');
    expect(result.status).toBe('succeeded');
    expect(result.promotionCode).toBeUndefined();
  });
});

describe('payments/drivers/stripe — session à 0 € (coupon 100 %)', () => {
  it('compte comme payée quand la session est complete et sans montant dû', async () => {
    // Stripe marque `no_payment_required` (pas `paid`) : sans ce cas, la
    // réconciliation de secours voyait un accès offert comme impayé à vie.
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_free',
      status: 'complete',
      payment_status: 'no_payment_required',
      amount_total: 0,
      currency: 'eur',
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    const status = await stripeDriver.retrieveSessionStatus('cs_free');
    expect(status.paid).toBe(true);
    expect(status.amountMinor).toBe(0);
  });

  it('une session ouverte sans montant dû n’est PAS considérée payée', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_open',
      status: 'open',
      payment_status: 'no_payment_required',
      amount_total: 0,
      currency: 'eur',
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    expect((await stripeDriver.retrieveSessionStatus('cs_open')).paid).toBe(false);
  });

  it('une session impayée reste impayée', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_unpaid',
      status: 'complete',
      payment_status: 'unpaid',
      amount_total: 5900,
      currency: 'eur',
    });
    const { stripeDriver } = await import('@/lib/payments/drivers/stripe');

    expect((await stripeDriver.retrieveSessionStatus('cs_unpaid')).paid).toBe(false);
  });
});
