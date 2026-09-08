/**
 * Taxonomie d'événements analytics (PostHog) — source de vérité unique.
 *
 * Convention de nommage : `snake_case`, verbe au passé (action accomplie),
 * alignée sur les conventions PostHog. Ce module est PUR (aucune dépendance à
 * `posthog-js`) → importable côté client ET côté serveur.
 *
 * Funnel marketing (acquisition → activation → monétisation) :
 *   $pageview (auto) → cta_clicked → signup_started → signup_completed
 *   → onboarding_completed → checkout_started → purchase_completed
 *
 * Boucle virale (invités d'un mariage → prospects) :
 *   invitation_viewed → rsvp_submitted / gallery_photo_uploaded → cta_clicked
 */
export const EVENTS = {
  // --- Acquisition / conversion marketing ---
  ctaClicked: 'cta_clicked',
  pricingPlanSelected: 'pricing_plan_selected',
  pricingBillingToggled: 'pricing_billing_toggled',
  faqOpened: 'faq_opened',
  sectionViewed: 'section_viewed',
  newsletterSubscribed: 'newsletter_subscribed',
  contactFormSubmitted: 'contact_form_submitted',
  // --- Signup / activation ---
  signupStarted: 'signup_started',
  signupCompleted: 'signup_completed',
  onboardingCompleted: 'onboarding_completed',
  // --- Monétisation ---
  checkoutStarted: 'checkout_started',
  purchaseCompleted: 'purchase_completed',
  // --- Observabilité money-path (T2, plan de lancement) : chaque event
  // ci-dessous doit déclencher une alerte PostHog active — c'est le
  // signal qui remplace « personne ne surveille les coutures ».
  webhookProcessingFailed: 'webhook_processing_failed',
  paymentReconciliationFailed: 'payment_reconciliation_failed',
  paymentReconciliationStuck: 'payment_reconciliation_stuck',
  entitlementWithoutPayment: 'entitlement_without_payment',
  // --- Démo publique `/demo` : RSVP simulé (jamais un vrai RSVP, donc
  // volontairement distinct de `rsvp_submitted` pour ne pas polluer la
  // boucle virale). Signal d'engagement avec la preuve produit.
  demoRsvpSubmitted: 'demo_rsvp_submitted',
  // --- Boucle virale : pages d'invitation publiques (invités) ---
  invitationViewed: 'invitation_viewed',
  rsvpSubmitted: 'rsvp_submitted',
  galleryViewed: 'gallery_viewed',
  galleryPhotoUploaded: 'gallery_photo_uploaded',
} as const;

export type AnalyticsEventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Audience produit (segmentation B2C particuliers vs B2B pros). */
export type AnalyticsAudience = 'consumer' | 'pro';

/** Périodicité d'abonnement pro. */
export type BillingPeriod = 'monthly' | 'annual';

/**
 * Propriétés « personne » non-PII envoyées à `identify`.
 * NE JAMAIS y mettre de PII (téléphone, email, nom) — uniquement des
 * dimensions de segmentation.
 */
export type AnalyticsPersonProps = {
  role?: 'couple' | 'pro' | 'guest' | 'admin';
  plan_tier?: string;
  locale?: string;
  account_age_days?: number;
};
