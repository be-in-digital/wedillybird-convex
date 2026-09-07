import type { Currency, PlanTier } from './plans';
import type { ProviderName } from './country';

export interface CheckoutInput {
  provider: ProviderName;
  plan: PlanTier;
  currency: Currency;
  amountMinor: number;
  eventId: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
  /** Optional — email client (pré-remplissage formulaire de paiement). */
  customerEmail?: string;
  /** Optional — téléphone client. */
  customerPhone?: string;
  /** Optional — id d'affilié attribué (posé en metadata de la session + PI). */
  affiliateId?: string;
  /** Optional — coupon Stripe (crédit de parrainage appliqué). Exclut le champ
   *  code promo (`allow_promotion_codes`) : Stripe interdit les deux ensemble. */
  discountCouponId?: string;
  /** Optional — token de réservation du crédit (posé en metadata de session,
   *  consommé à la confirmation). */
  creditReservationId?: string;
}

export interface CheckoutSession {
  providerSessionId: string;
  redirectUrl: string;
}

export interface VerifiedWebhookEvent {
  providerSessionId: string;
  providerEventId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  /** Montant RÉELLEMENT encaissé (après coupon / code promo), en centimes. */
  amountMinor: number;
  currency: Currency;
  failureReason?: string;
  /**
   * Code promo lisible saisi par l'acheteur au checkout, s'il y en a un.
   *
   * Sert au rattrapage d'attribution : un acheteur qui TAPE le code d'un
   * partenaire (au lieu de cliquer son lien `?ref=`) n'a pas de cookie
   * `wdb_ref`, donc pas d'`affiliateId` sur le paiement — sans ce champ, la
   * commission était perdue en silence.
   */
  promotionCode?: string;
}

export interface SessionStatus {
  paid: boolean;
  providerSessionId: string;
  providerEventId: string;
  /** Montant réellement encaissé (après remise), en centimes. */
  amountMinor: number;
  currency: Currency;
  /**
   * Code promo appliqué, si le provider sait le dire. Même rôle que sur
   * `VerifiedWebhookEvent` : quand la réconciliation (cron / page de succès)
   * gagne la course contre le webhook, c'est elle qui doit rattacher la vente
   * au partenaire — sinon la commission est perdue pour de bon.
   */
  promotionCode?: string;
}

export interface PaymentDriver {
  readonly name: ProviderName;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  verifyAndParseWebhook(rawBody: string, signature: string | null): Promise<VerifiedWebhookEvent>;
  retrieveSessionStatus(providerSessionId: string): Promise<SessionStatus>;
}
