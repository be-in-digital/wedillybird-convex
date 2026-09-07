import posthog from 'posthog-js';
import {
  EVENTS,
  type AnalyticsAudience,
  type AnalyticsEventName,
  type AnalyticsPersonProps,
  type BillingPeriod,
} from './events';
import { metaTrack, setMetaConsent } from './meta-pixel';

/**
 * Couche analytics PostHog côté client.
 *
 * Init via `instrumentation-client.ts` (Next.js 15.3+), JAMAIS via un
 * `PostHogProvider` — les deux approches ne se combinent pas. On importe
 * ensuite le singleton `posthog` partout (cf. doc PostHog Next.js).
 *
 * RGPD (société FR) : `opt_out_capturing_by_default` → aucune capture ni
 * cookie de tracking tant que l'utilisateur n'a pas explicitement accepté la
 * bannière de consentement. `setAnalyticsConsent` (appelée par `CookieConsent`)
 * fait l'opt-in / opt-out.
 */

/** Clé localStorage du consentement RGPD (cf. components/layout/cookie-consent.tsx). */
export const CONSENT_STORAGE_KEY = 'wedillybird-cookie-consent';

let initialized = false;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function readStoredConsent(): 'accepted' | 'declined' | null {
  if (!isBrowser()) return null;
  try {
    const v = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return v === 'accepted' || v === 'declined' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Initialise PostHog. Appelé une fois depuis `instrumentation-client.ts`
 * (avant l'hydratation React). Idempotent et no-op côté serveur.
 */
export function initPostHogClient(): void {
  if (initialized || !isBrowser()) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  initialized = true;

  posthog.init(key, {
    // Reverse proxy same-origin (cf. next.config.ts) : déjoue les bloqueurs de
    // pub/tracking et reste compatible avec la CSP `connect-src 'self'`.
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30',
    // Pageviews SPA automatiques (history API, gère les préfixes de locale
    // next-intl) + temps passé (pour le taux de rebond / sortie).
    capture_pageview: 'history_change',
    capture_pageleave: true,
    // Autocapture clics/inputs : comportement visiteur sans instrumentation.
    autocapture: true,
    // Heatmaps (CRO) + web vitals (perf perçue, corrèle avec la conversion).
    enable_heatmaps: true,
    capture_performance: true,
    // Error tracking : exceptions non gérées remontées automatiquement.
    capture_exceptions: true,
    // Profils « personne » uniquement pour les identifiés (anonymes = events
    // sans profil → moins cher, plus respectueux de la vie privée).
    person_profiles: 'identified_only',
    // Session replay : démarré seulement à l'opt-in (cf. setAnalyticsConsent).
    disable_session_recording: true,
    // RGPD : silence total tant que pas de consentement explicite.
    opt_out_capturing_by_default: true,
    debug: process.env.NODE_ENV === 'development',
    loaded: (ph) => {
      try {
        if (readStoredConsent() === 'accepted') {
          ph.opt_in_capturing();
          ph.startSessionRecording?.();
        }
      } catch {
        /* l'analytics ne doit jamais casser l'app */
      }
    },
  });
}

/** Attache des propriétés communes (locale courante) à chaque event. */
function withCommonProps(props?: Record<string, unknown>): Record<string, unknown> {
  const locale = isBrowser() ? document.documentElement.lang || undefined : undefined;
  return locale ? { locale, ...props } : { ...props };
}

/**
 * Capture générique. No-op si PostHog n'est pas initialisé ou côté serveur.
 * Si l'utilisateur n'a pas consenti, PostHog filtre lui-même l'envoi (opt-out).
 */
export function track(event: AnalyticsEventName | string, props?: Record<string, unknown>): void {
  if (!initialized || !isBrowser()) return;
  try {
    posthog.capture(event, withCommonProps(props));
  } catch {
    /* no-op */
  }
}

/** Identifie l'utilisateur connecté (person-props NON-PII uniquement). */
export function identifyUser(distinctId: string, props?: AnalyticsPersonProps): void {
  if (!initialized || !isBrowser() || !distinctId) return;
  try {
    posthog.identify(distinctId, props);
  } catch {
    /* no-op */
  }
}

/** Réinitialise l'identité (à appeler à la déconnexion). */
export function resetAnalytics(): void {
  if (!initialized || !isBrowser()) return;
  try {
    posthog.reset();
  } catch {
    /* no-op */
  }
}

/** Capture une exception applicative (error tracking). */
export function captureException(error: unknown, props?: Record<string, unknown>): void {
  if (!initialized || !isBrowser()) return;
  try {
    posthog.captureException(error, withCommonProps(props));
  } catch {
    /* no-op */
  }
}

/**
 * Applique le consentement RGPD. Appelée par `CookieConsent`.
 * - accepté → opt-in + (ré)active le replay + capture le pageview courant
 *   (sinon perdu, car la page d'atterrissage est chargée avant l'opt-in).
 * - refusé → opt-out + stoppe le replay.
 */
export function setAnalyticsConsent(granted: boolean): void {
  if (!isBrowser()) return;
  try {
    if (!initialized) initPostHogClient();
    if (granted) {
      posthog.opt_in_capturing();
      posthog.startSessionRecording?.();
      posthog.capture('$pageview');
    } else {
      posthog.stopSessionRecording?.();
      posthog.opt_out_capturing();
    }
    // Pixel Meta piloté par le même consentement (chargé seulement si accepté).
    setMetaConsent(granted);
  } catch {
    /* no-op */
  }
}

/**
 * API typée de capture — contrat unique pour toute l'instrumentation.
 * Préférer ces méthodes à `track(...)` brut pour garder une taxonomie cohérente.
 */
export const analytics = {
  /** Clic sur un CTA (toute destination : /sign-up, ancre, contact…). */
  ctaClicked(props: {
    source: string;
    destination?: string;
    plan?: string;
    billing?: BillingPeriod;
    audience?: AnalyticsAudience;
    label?: string;
  }): void {
    track(EVENTS.ctaClicked, props);
  },
  /** Sélection d'un forfait sur une carte de pricing. */
  pricingPlanSelected(props: {
    tier: string;
    audience: AnalyticsAudience;
    billing?: BillingPeriod;
  }): void {
    track(EVENTS.pricingPlanSelected, props);
  },
  /** Bascule mensuel ↔ annuel sur le pricing pro. */
  pricingBillingToggled(props: { billing: BillingPeriod; audience?: AnalyticsAudience }): void {
    track(EVENTS.pricingBillingToggled, props);
  },
  /** Ouverture d'une question de la FAQ (signal d'objection / friction). */
  faqOpened(props: { question: string; source?: string }): void {
    track(EVENTS.faqOpened, props);
  },
  /**
   * Section de la landing entrée dans le viewport (mesure des fuites de scroll).
   * Émis une fois par changement de section active, pas à chaque frame de scroll.
   */
  sectionViewed(props: { id: string }): void {
    track(EVENTS.sectionViewed, props);
  },
  /** Inscription newsletter (côté client ; doublé côté serveur dans /api/newsletter). */
  newsletterSubscribed(props?: { source?: string }): void {
    track(EVENTS.newsletterSubscribed, props);
  },
  /** Envoi du formulaire de contact (doublé côté serveur dans /api/contact). */
  contactFormSubmitted(props?: { subject_category?: string }): void {
    track(EVENTS.contactFormSubmitted, props);
  },
  /** Entrée dans le tunnel d'inscription (vue/première interaction sign-up). */
  signupStarted(props?: { method?: string; plan?: string; billing?: BillingPeriod }): void {
    track(EVENTS.signupStarted, props);
  },
  /** Compte créé (OTP/magic link vérifié). */
  signupCompleted(props?: { method?: 'whatsapp' | 'email' }): void {
    track(EVENTS.signupCompleted, props);
    metaTrack('CompleteRegistration');
  },
  /** Onboarding terminé (profil complété, rôle choisi). */
  onboardingCompleted(props: { role: 'couple' | 'pro' | 'admin' }): void {
    track(EVENTS.onboardingCompleted, props);
  },
  /** Démarrage du checkout (doublé/fiabilisé côté serveur). */
  checkoutStarted(props: { plan: string; audience?: AnalyticsAudience; currency?: string }): void {
    track(EVENTS.checkoutStarted, props);
    metaTrack('InitiateCheckout', props.currency ? { currency: props.currency } : undefined);
  },
  /** Vue d'une page d'invitation publique (haut de la boucle virale). */
  invitationViewed(props?: { white_label?: boolean }): void {
    track(EVENTS.invitationViewed, props);
  },
  /** RSVP d'un invité. */
  rsvpSubmitted(props: { status: string }): void {
    track(EVENTS.rsvpSubmitted, props);
  },
  /** Vue de la galerie publique. */
  galleryViewed(props?: { photo_count?: number }): void {
    track(EVENTS.galleryViewed, props);
  },
  /** Upload d'une photo par un invité. */
  galleryPhotoUploaded(props?: Record<string, unknown>): void {
    track(EVENTS.galleryPhotoUploaded, props);
  },
};
