import type { PostHog } from 'posthog-js';
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
 * `PostHogProvider` — les deux approches ne se combinent pas.
 *
 * Deux niveaux d'observation (sept. 2026), pilotés par la bannière
 * `CookieConsent` via `setAnalyticsConsent` :
 *
 * 1. **Mesure d'audience sans cookie, pour tout le monde** — `cookieless_mode:
 *    'on_reject'` + `opt_out_capturing_by_default: true` : tant que le visiteur
 *    n'a pas accepté (état « en attente » ou refus explicite), PostHog n'écrit
 *    RIEN sur l'appareil (ni cookie, ni localStorage, ni sessionStorage) ;
 *    l'identité est un hash quotidien calculé côté serveur PostHog. Pages vues,
 *    sections scrollées, clics CTA, questions FAQ, démo : tout est observé,
 *    anonymement. Même base que Vercel Web Analytics (exemption « mesure
 *    d'audience »). ⚠️ Ce mode doit être ACTIVÉ dans le projet PostHog
 *    (Settings → « Cookieless server hash mode »), sinon ces events sont
 *    ignorés à l'ingestion.
 * 2. **Après « Accepter »** — opt-in classique : cookie/localStorage, session
 *    replay, heatmaps, profil rattaché à l'inscription (`identifyUser`), et
 *    pixel Meta. C'est ce niveau qui permet de REGARDER une session.
 *
 * Chargement différé : `posthog-js` (~200 ko) est importé dynamiquement (chunk
 * séparé) quand le navigateur est inactif après le chargement de la page,
 * pour ne pas concurrencer le LCP du hero. L'API publique de ce module
 * (`track`, `analytics.*`, `identifyUser`…) est inchangée : les appels émis
 * avant l'arrivée du SDK sont mis en file d'attente puis rejoués.
 */

/** Clé localStorage du consentement RGPD (cf. components/layout/cookie-consent.tsx). */
export const CONSENT_STORAGE_KEY = 'wedillybird-cookie-consent';

/** Taille max de la file d'attente pendant le chargement du SDK. */
const PENDING_MAX = 32;

let initialized = false;
let instance: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
const pending: Array<(ph: PostHog) => void> = [];

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
 * Charge et initialise le SDK (une seule fois). Résout `null` si pas de clé,
 * hors navigateur, ou si le chunk ne peut pas être chargé (adblock agressif) :
 * l'analytics ne doit jamais casser l'app.
 */
function loadPostHog(): Promise<PostHog | null> {
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || !isBrowser()) return Promise.resolve(null);

  loading = import('posthog-js')
    .then(({ default: posthog }) => {
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
        // RGPD : sans consentement explicite, aucun cookie ni stockage — mais
        // la mesure d'audience continue en mode sans cookie (hash serveur).
        // Le refus (`opt_out_capturing`) reste dans ce mode ; l'acceptation
        // (`opt_in_capturing`) bascule en mode complet.
        opt_out_capturing_by_default: true,
        cookieless_mode: 'on_reject',
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
      instance = posthog;
      // Rejoue les appels émis pendant le chargement, dans l'ordre.
      for (const fn of pending.splice(0)) {
        try {
          fn(posthog);
        } catch {
          /* no-op */
        }
      }
      return posthog;
    })
    .catch(() => {
      pending.length = 0;
      return null;
    });
  return loading;
}

/**
 * Exécute `fn` sur le SDK : tout de suite s'il est chargé, à la fin du
 * chargement sinon (file d'attente bornée, rejouée dans l'ordre).
 */
function withPostHog(fn: (ph: PostHog) => void): void {
  if (!initialized || !isBrowser()) return;
  if (instance) {
    try {
      fn(instance);
    } catch {
      /* no-op */
    }
    return;
  }
  void loadPostHog();
  if (pending.length < PENDING_MAX) pending.push(fn);
}

/** Différe `fn` jusqu'à un moment d'inactivité du navigateur (LCP d'abord). */
function whenIdle(fn: () => void): void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  const schedule = () => {
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 3000 });
    else setTimeout(fn, 1500);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
}

/**
 * Initialise l'analytics. Appelé une fois depuis `instrumentation-client.ts`
 * (avant l'hydratation React). Idempotent et no-op côté serveur. Le SDK est
 * chargé pour tout le monde (mesure sans cookie), mais après le chargement de
 * la page et hors du chemin critique.
 */
export function initPostHogClient(): void {
  if (initialized || !isBrowser()) return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  initialized = true;
  whenIdle(() => void loadPostHog());
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
  const payload = withCommonProps(props);
  withPostHog((ph) => ph.capture(event, payload));
}

/** Identifie l'utilisateur connecté (person-props NON-PII uniquement). */
export function identifyUser(distinctId: string, props?: AnalyticsPersonProps): void {
  if (!distinctId) return;
  withPostHog((ph) => ph.identify(distinctId, props));
}

/** Réinitialise l'identité (à appeler à la déconnexion). */
export function resetAnalytics(): void {
  withPostHog((ph) => ph.reset());
}

/** Capture une exception applicative (error tracking). */
export function captureException(error: unknown, props?: Record<string, unknown>): void {
  const payload = withCommonProps(props);
  withPostHog((ph) => ph.captureException(error, payload));
}

/**
 * Applique le consentement RGPD. Appelée par `CookieConsent`.
 * - accepté → opt-in (cookies + profil), (ré)active le replay, et re-capture
 *   le pageview courant sous la nouvelle identité (le pageview d'arrivée a été
 *   compté sous le hash sans cookie ; on marque celui-ci `consent_upgrade`
 *   pour pouvoir l'exclure des volumes et ne garder que le funnel).
 * - refusé → opt-out explicite : PostHog reste en mode sans cookie (mesure
 *   d'audience anonyme), replay stoppé, pixel Meta jamais chargé.
 */
export function setAnalyticsConsent(granted: boolean): void {
  if (!isBrowser()) return;
  try {
    if (!initialized) initPostHogClient();
    void loadPostHog().then((ph) => {
      if (!ph) return;
      try {
        if (granted) {
          ph.opt_in_capturing();
          ph.startSessionRecording?.();
          ph.capture('$pageview', { consent_upgrade: true });
        } else {
          ph.stopSessionRecording?.();
          ph.opt_out_capturing();
        }
      } catch {
        /* no-op */
      }
    });
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
